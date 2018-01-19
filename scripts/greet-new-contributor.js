// Description:
//   Script that listens to new GitHub pull requests
//   and greets the user if it is their first PR on the repo
//
// Dependencies:
//   github: "^13.1.0"
//   hubot-github-webhook-listener: "^0.9.1"
//
// Author:
//   PombeirP

module.exports = function(robot) {

  const gitHubContext = require('./github-context.js')();

  return robot.on("github-repo-event", function(repo_event) {
    const githubPayload = repo_event.payload;

    switch(repo_event.eventType) {
      case "pull_request":
        // Make sure we don't listen to our own messages
        if (gitHubContext.equalsRobotName(robot, githubPayload.pull_request.user.login)) { return; }

        var { action } = githubPayload;
        if (action === "opened") {
          // A new PR was opened
          return greetNewContributor(gitHubContext, githubPayload, robot);
        }
        break;
    }
  });
};

async function greetNewContributor(gitHubContext, githubPayload, robot) {
  // TODO: Read the welcome message from a (per-repo?) file (e.g. status-react.welcome-msg.md)
  const github = gitHubContext.api();
  const welcomeMessage = gitHubContext.config()['pull-requests']['welcome-bot'].message;
  const ownerName = githubPayload.repository.owner.login;
  const repoName = githubPayload.repository.name;
  const prNumber = githubPayload.pull_request.number;

  robot.logger.info(`greetNewContributor - Handling Pull Request #${prNumber} on repo ${ownerName}/${repoName}`);

  try {
    ghissues = await github.issues.getForRepo({
      owner: ownerName,
      repo: repoName,
      state: 'all',
      creator: githubPayload.pull_request.user.login
    })

    const userPullRequests = ghissues.data.filter(issue => issue.pull_request);
    if (userPullRequests.length === 1) {
      try {
        await github.issues.createComment({
          owner: ownerName,
          repo: repoName,
          number: prNumber,
          body: welcomeMessage
        })
      } catch (err) {
        if (err.code !== 404) {
          robot.logger.error(`Couldn't create comment on PR: ${err}`, ownerName, repoName);
        }
      }
    } else {
      robot.logger.debug("This is not the user's first PR on the repo, ignoring", ownerName, repoName, githubPayload.pull_request.user.login);
    }
  } catch (err) {
    robot.logger.error(`Couldn't fetch the user's github issues for repo: ${err}`, ownerName, repoName);
  }
};