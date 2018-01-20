// Description:
//   Script that listens to new labels on GitHub issues
//   and assigns the issues to the bounty-awaiting-approval column on the "Status SOB Swarm" project
//
// Dependencies:
//   github: "^13.1.0"
//   hubot-github-webhook-listener: "^0.9.1"
//   hubot-slack: "^4.4.0"
//
// Author:
//   PombeirP

module.exports = function(robot) {

  const gitHubContext = require('./github-context.js')();

  return robot.on("github-repo-event", function(repo_event) {
    const githubPayload = repo_event.payload;

    switch(repo_event.eventType) {
      case "issues":
        // Make sure we don't listen to our own messages
        if (gitHubContext.equalsRobotName(robot, githubPayload.issue.user.login)) { return; }

        var { action } = githubPayload;
        if (action === "labeled") {
          // A new issue was labeled
          return assignIssueToBountyAwaitingForApproval(gitHubContext, githubPayload, robot);
        }
        break;
    }
  });
};

async function assignIssueToBountyAwaitingForApproval(gitHubContext, githubPayload, robot) {
  const github = gitHubContext.api();
  const githubConfig = gitHubContext.config();
  const ownerName = githubPayload.repository.owner.login;
  const repoName = githubPayload.repository.name;
  const issueNumber = githubPayload.issue.number;

  robot.logger.info(`assignIssueToBountyAwaitingForApproval - Handling Issue #${issueNumber} on repo ${ownerName}/${repoName}`);

  // Fetch org projects
  // TODO: The org project and project column info should be cached
  // in order to improve performance and reduce roundtrips
  try {
    const orgName = 'status-im';

    ghprojects = await github.projects.getOrgProjects({
      org: orgName,
      state: "open"
    });

    // Find "Status SOB Swarm" project
    const projectBoardName = githubConfig['bounty-awaiting-approval']['project-board'].name;
    const project = ghprojects.data.find(function(p) { return p.name === projectBoardName });
    if (!project) {
      robot.logger.error(`Couldn't find project ${projectBoardName} in ${orgName} org`);
      return;
    }
    
    robot.logger.debug(`Fetched ${project.name} project (${project.id})`);

    // Fetch bounty-awaiting-approval column ID
    try {
      ghcolumns = await github.projects.getProjectColumns({ project_id: project.id });  

      const approvalColumnName = githubConfig['bounty-awaiting-approval']['project-board']['approval-column-name'];
      const column = ghcolumns.data.find(function(c) { return c.name === approvalColumnName });
      if (!column) {
        robot.logger.error(`Couldn't find ${approvalColumnName} column in project ${project.name}`);
        return;
      }
      
      robot.logger.debug(`Fetched ${column.name} column (${column.id})`);

      // Create project card for the issue in the bounty-awaiting-approval column
      try {
        ghcard = await github.projects.createProjectCard({
          column_id: column.id,
          content_type: 'Issue',
          content_id: githubPayload.issue.id
        });

        robot.logger.debug(`Created card: ${ghcard.data.url}`, ghcard.data.id);

        // Send message to Slack
        robot.messageRoom(githubConfig.slack.notification.room, `Assigned issue to ``${approvalColumnName}`` in ``${projectBoardName}`` project\n${githubPayload.issue.html_url}`);
      } catch (err) {
        robot.logger.error(`Couldn't create project card for the issue: ${err}`, column.id, githubPayload.issue.id);
      }
    } catch (err) {
      robot.logger.error(`Couldn't fetch the github columns for project: ${err}`, ownerName, repoName, project.id);
    }
  } catch (err) {
    robot.logger.error(`Couldn't fetch the github projects for repo: ${err}`, ownerName, repoName);
  }
};
