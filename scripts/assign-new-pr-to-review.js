// Description:
//   Script that listens to new GitHub pull requests
//   and assigns them to the REVIEW column on the "Pipeline for QA" project
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config "^0.1.0"
//   probot-slack-status: "^0.2.2"
//
// Author:
//   PombeirP

const getConfig = require('probot-config');
const Slack = require('probot-slack-status');

let slackClient = null;

module.exports = function(robot) {
  // robot.on('slack.connected', ({ slack }) => {
  Slack(robot, (slack) => {
    robot.log.trace("Connected, assigned slackClient");
    slackClient = slack;
  });
  
  robot.on('pull_request.opened', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return; }

    // A new PR was opened
    await assignPullRequestToReview(context, robot);
  });
};

async function assignPullRequestToReview(context, robot) {
  const payload = context.payload;
  const github = context.github;
  const config = await getConfig(context, 'github-bot.yml')
  const ownerName = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const prNumber = payload.pull_request.number;

  robot.log(`assignPullRequestToReview - Handling Pull Request #${prNumber} on repo ${ownerName}/${repoName}`);

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
    const projectBoardName = config['new-pull-requests']['project-board'].name;
    const project = ghprojects.data.find(function(p) { return p.name === projectBoardName });
    if (!project) {
      robot.log.error(`Couldn't find project ${projectBoardName} in repo ${ownerName}/${repoName}`);
      return;
    }
    
    robot.log.debug(`Fetched ${project.name} project (${project.id})`);

    // Fetch REVIEW column ID
    try {
      ghcolumns = await github.projects.getProjectColumns({ project_id: project.id });  

      const reviewColumnName = config['new-pull-requests']['project-board']['review-column-name'];
      const column = ghcolumns.data.find(function(c) { return c.name === reviewColumnName });
      if (!column) {
        robot.log.error(`Couldn't find ${reviewColumnName} column in project ${project.name}`);
        return;
      }
      
      robot.log.debug(`Fetched ${column.name} column (${column.id})`);

      // Create project card for the PR in the REVIEW column
      try {
        ghcard = await github.projects.createProjectCard({
          column_id: column.id,
          content_type: 'PullRequest',
          content_id: payload.pull_request.id
        });

        robot.log.debug(`Created card: ${ghcard.data.url}`, ghcard.data.id);

        // Send message to Slack
        if (slackClient != null) {
          const channel = slackClient.dataStore.getChannelByName(config.slack.notification.room);
          try {
            await slackClient.sendMessage(`Assigned PR to ${reviewColumnName} in ${projectBoardName} project\n${payload.pull_request.html_url}`, channel.id);
          } catch(err) {
            robot.log.error(`Failed to send Slack message to ${config.slack.notification.room} channel`);
          }
        } else {
          robot.log.debug("Slack client not available");
        }
      } catch (err) {
        robot.log.error(`Couldn't create project card for the PR: ${err}`, column.id, payload.pull_request.id);
      }
    } catch (err) {
      robot.log.error(`Couldn't fetch the github columns for project: ${err}`, ownerName, repoName, project.id);
    }
  } catch (err) {
    robot.log.error(`Couldn't fetch the github projects for repo: ${err}`, ownerName, repoName);
  }
};
