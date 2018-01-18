// Description:
//   Script that listens to new GitHub pull requests
//   and assigns them to the REVIEW column on the "Pipeline for QA" project
//
// Dependencies:
//   github: "^13.1.0"
//   hubot-github-webhook-listener: "^0.9.1"
//   hubot-slack: "^4.4.0"
//
// Notes:
//   The hard-coded names for the project board and review column are just below.
//   These could be read from a config file (e.g. YAML)
//
// Author:
//   PombeirP

const projectBoardName = "Pipeline for QA";
const reviewColumnName = "REVIEW";
const notifyRoomName = "core";

module.exports = function(robot) {

  const context = require('./github-context.js');

  return robot.on("github-repo-event", function(repo_event) {
    const githubPayload = repo_event.payload;

    switch(repo_event.eventType) {
      case "pull_request":
        // Make sure we don't listen to our own messages
        if (context.equalsRobotName(robot, githubPayload.pull_request.user.login)) { return; }

        var { action } = githubPayload;
        if (action === "opened") {
          // A new PR was opened
          return assignPullRequestToReview(context.github(), githubPayload, robot);
        }
        break;
    }
  });
};

async function assignPullRequestToReview(github, githubPayload, robot) {
  const ownerName = githubPayload.repository.owner.login;
  const repoName = githubPayload.repository.name;
  const prNumber = githubPayload.pull_request.number;

  robot.logger.info(`assignPullRequestToReview - Handling Pull Request #${prNumber} on repo ${ownerName}/${repoName}`);

  // Fetch repo projects
  // TODO: The repo project and project column info should be cached
  // in order to improve performance and reduce roundtrips
  try {
    ghprojects = await github.projects.getRepoProjects({
      owner: ownerName,
      repo: repoName,
      state: "open"
    });

    // Find "Pipeline for QA" project
    const project = ghprojects.data.find(function(p) { return p.name === projectBoardName });
    if (!project) {
      robot.logger.warn(`Couldn't find project ${projectBoardName} in repo ${ownerName}/${repoName}`);
      return;
    }
    
    robot.logger.debug(`Fetched ${project.name} project (${project.id})`);

    // Fetch REVIEW column ID
    try {
      ghcolumns = await github.projects.getProjectColumns({ project_id: project.id });  

      const column = ghcolumns.data.find(function(c) { return c.name === reviewColumnName });
      if (!column) {
        robot.logger.warn(`Couldn't find ${projectBoardName} column in project ${project.name}`);
        return;
      }
      
      robot.logger.debug(`Fetched ${column.name} column (${column.id})`);

      // Create project card for the PR in the REVIEW column
      try {
        ghcard = await github.projects.createProjectCard({
          column_id: column.id,
          content_type: 'PullRequest',
          content_id: githubPayload.pull_request.id
        });

        robot.logger.debug(`Created card: ${ghcard.data.url}`, ghcard.data.id);

        // Send message to Slack
        robot.messageRoom(notifyRoomName, `Moved PR ${githubPayload.pull_request.number} to ${reviewColumnName} in ${projectBoardName} project`
        );
      } catch (err) {
        robot.logger.error(`Couldn't create project card for the PR: ${err}`, column.id, githubPayload.pull_request.id);
      }
    } catch (err) {
      robot.logger.error(`Couldn't fetch the github columns for project: ${err}`, ownerName, repoName, project.id);
    }
  } catch (err) {
    robot.logger.error(`Couldn't fetch the github projects for repo: ${err}`, ownerName, repoName);
  }
};
