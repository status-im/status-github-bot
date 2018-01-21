// Description:
//   Script that keeps GitHub-related context to be shared among scripts
//
// Dependencies:
//   github: "^13.1.0"
//
// Author:
//   PombeirP

const GitHubApi = require('github');

let cachedRobotNameRegex;
let initialized = false;
let initializing = false;
const githubAPI = new GitHubApi({
  timeout: 15000,
  requestMedia: 'application/vnd.github.v3+json'
});
let githubConfig = null;

module.exports = function() {
  return {
    api() { return githubAPI; },

    config() { return githubConfig; },

    async initialize(robot, integrationID, installationID) {
      if (initialized || initializing) { return; }
      initializing = true;

      try {
        if (githubConfig == null) {
          githubConfig = loadConfig(robot, './github.yaml')
        }

        await ensureValidToken(robot, integrationID, installationID);

        initialized = true;
      } catch (err) {
        // Do nothing
      } finally {
        initializing = false;
      }
    },

    equalsRobotName(robot, str) {
      return getRegexForRobotName(robot).test(str);
    }
  };

  async function ensureValidToken(robot, integrationID, installationID) {
    const token = getToken(robot);
    if (token) {
      process.env.HUBOT_GITHUB_TOKEN = token;
      robot.logger.debug("Reused cached GitHub token");
      githubAPI.authenticate({ type: 'token', token });
      return;
    }

    const jwtLib = require('jwt-simple');

    // Private key contents
    let privateKey = process.env.GITHUB_PEM;

    const now = Math.round(Date.now() / 1000);
    // Generate the JWT
    const payload = {
      // issued at time
      iat: now,
      // JWT expiration time (10 minute maximum)
      exp: now + (1 * 60),
      // GitHub App's identifier
      iss: integrationID
    };

    jwt = jwtLib.encode(payload, privateKey, 'RS256');
    githubAPI.authenticate({
      type: 'integration',
      token: jwt
    });
    robot.logger.debug("Configured integration authentication with JWT", jwt);

    await createAccessToken(robot, githubAPI, installationID);
  }

  function getRegexForRobotName(robot) {
    // This comes straight out of Hubot's Robot.coffee
    // - they didn't get a nice way of extracting that method though
    if (!cachedRobotNameRegex) {
      let namePattern;
      const name = robot.name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

      if (robot.alias) {
        const alias = robot.alias.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        namePattern = `^\\s*[@]?(?:${alias}|${name})`;
      } else {
        namePattern = `^\\s*[@]?${name}`;
      }
      cachedRobotNameRegex = new RegExp(namePattern, 'i');
    }
    return cachedRobotNameRegex;
  }
};

function loadConfig(robot, fileName) {
  // Get document, or throw exception on error
  try {
    const yaml = require('js-yaml');
    const fs   = require('fs');

    return yaml.safeLoad(fs.readFileSync(fileName, 'utf8'));
  } catch (e) {
    robot.logger.error(e);
  }

  return null;
}

function getToken(robot) {
  const expiresAt = robot.brain.get('github-token-expires-at');
  token = robot.brain.get('github-token');
  if (expiresAt) {
    expiresAt = Date.parse(expiresAt);
    if (Date.now() >= expiresAt - 60 * 1000) {
      robot.logger.debug("Cached GitHub token has expired");
      token = null; // Token has expired
    }
  } else {
    // If no expiration is set, assume this is an old deployment and invalidate the token
    token = null;
  }

  return token;
}

function expireGitHubToken(robot) {
  const gitHubContext = require('./github-context.js')();

  robot.brain.set('github-token', null);
  process.env.HUBOT_GITHUB_TOKEN = null;

  appID = robot.brain.get("github-app_id");
  installationID = robot.brain.get("github-installation_id");
  if (installationID) {
    gitHubContext.ensureValidToken(robot, appID, installationID);
  }
}

async function createAccessToken(robot, github, id) {
  try {
    robot.logger.debug("Creating GitHub access token for installation");

    response = await github.apps.createInstallationToken({ installation_id: id }); 

    process.env.HUBOT_GITHUB_TOKEN = response.data.token;
    robot.brain.set('github-token', response.data.token);
    robot.brain.set('github-token-expires-at', response.data.expires_at);

    expiresAt = Date.parse(response.data.expires_at);
    setTimeout(expireGitHubToken, (expiresAt - 60 * 1000) - Date.now(), robot);

    github.authenticate({
      type: 'token',
      token: response.data.token
    });

    robot.logger.debug(`Created GitHub access token for installation, expires at ${response.data.expires_at}`);
  } catch (err) {
    robot.logger.error(`Couldn't create installation token: ${err}`, id);

    throw err;
  }
}
