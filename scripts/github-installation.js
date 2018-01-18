// Description:
//   Script that handles the installation of the GitHub app
//
// Dependencies:
//   github: "^13.1.0"
//   hubot-github-webhook-listener: "^0.9.1"
//
// Author:
//   PombeirP

module.exports = function(robot) {

  const gitHubContext = require('./github-context.js');

  return robot.on("github-repo-event", async function(repo_event) {
    const githubPayload = repo_event.payload;

    robot.logger.debug(`Received ${repo_event.eventType}/${githubPayload.action} event from GitHub`);

    switch(repo_event.eventType) {
      case "integration_installation":
        // Make sure we don't listen to our own messages
        if (gitHubContext.equalsRobotName(robot, githubPayload.sender.login)) { return; }

        var { action } = githubPayload;
        switch (action) {
          case "created":
            // App was installed on an organization
            robot.logger.info(`Initializing installation for app with ID ${githubPayload.installation.app_id} and installation ID ${githubPayload.installation.id}`);

            robot.brain.set('github-app_install-payload', JSON.stringify(githubPayload));
            robot.brain.set('github-app_id', githubPayload.installation.app_id);
            robot.brain.set('github-app_repositories', githubPayload.repositories.map((x) => x.full_name).join());

            gitHubContext.initialize(robot, githubPayload.installation.app_id);

            var perms = githubPayload.installation.permissions;
            if (perms.repository_projects !== 'write') { robot.logger.error(formatPermMessage('repository_projects', 'write')); }
            if (perms.metadata !== 'read') { robot.logger.error(formatPermMessage('metadata', 'read')); }
            if (perms.issues !== 'read') { robot.logger.error(formatPermMessage('issues', 'read')); }
            if (perms.pull_requests !== 'write') { robot.logger.error(formatPermMessage('pull_requests', 'write')); }
            
            if (!githubPayload.installation.events.includes('pull_request')) {
              robot.logger.error("Please enable 'pull_request' events in the app configuration on github.com");
            }

            await createAccessToken(robot, gitHubContext.api(), githubPayload.installation.id);
            break;
          case "deleted":
            // App was uninstalled from an organization
            robot.logger.info(`Removing installation for app with ID ${githubPayload.installation.app_id} and installation ID ${githubPayload.installation.id}`);

            robot.brain.set('github-app_id', null);
            robot.brain.set('github-app_install-payload', null);
            robot.brain.set('github-app_repositories', null);
            robot.brain.set('github-token', null);
            process.env.HUBOT_GITHUB_TOKEN = null;
            break;
        }
        break;
    }
  });
};

async function createAccessToken(robot, github, id) {
  try {
    response = await github.apps.createInstallationToken({ installation_id: id }); 

    robot.brain.set('github-token', response.data.token);
    // TODO: Set Redis expiration date to value from response.data.expires_at
    process.env.HUBOT_GITHUB_TOKEN = response.data.token;
    github.authenticate({
      type: 'token',
      token: response.data.token
    });
} catch (err) {
    robot.logger.error(`Couldn't create installation token: ${err}`, id);
  }
}

var formatPermMessage = (permName, perm) => `Please enable '${permName}' ${perm} permission in the app configuration on github.com`;