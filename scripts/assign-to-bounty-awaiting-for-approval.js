// Description:
//   Script that listens to new labels on GitHub issues
//   and assigns the issues to the bounty-awaiting-approval column on the "Status SOB Swarm" project
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//   probot-slack-status: "^0.2.2"
//
// Author:
//   PombeirP

const getConfig = require('probot-config')
const defaultConfig = require('../lib/config')
const Slack = require('probot-slack-status')

let slackClient = null

module.exports = function(robot) {
  // robot.on('slack.connected', ({ slack }) => {
  Slack(robot, (slack) => {
    robot.log.trace("Connected, assigned slackClient")
    slackClient = slack
  })
  
  robot.on('issues.labeled', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return }
    
    // A new issue was labeled
    await assignIssueToBountyAwaitingForApproval(context, robot)
  })
}

async function assignIssueToBountyAwaitingForApproval(context, robot) {
  const github = context.github
  const payload = context.payload
  //const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const config = defaultConfig(robot, '.github/github-bot.yml')
  const ownerName = payload.repository.owner.login
  const repoName = payload.repository.name
  const issueNumber = payload.issue.number
  
  if (!config['bounty-project-board']) {
    return;
  }
  
  robot.log(`assignIssueToBountyAwaitingForApproval - Handling Issue #${issueNumber} on repo ${ownerName}/${repoName}`)
  
  // Fetch org projects
  // TODO: The org project and project column info should be cached
  // in order to improve performance and reduce roundtrips
  try {
    const orgName = 'status-im'
    
    ghprojects = await github.projects.getOrgProjects({
      org: orgName,
      state: "open"
    })
    
    // Find "Status SOB Swarm" project
    const projectBoardName = config['bounty-project-board'].name
    const project = ghprojects.data.find(function(p) { return p.name === projectBoardName })
    if (!project) {
      robot.log.error(`Couldn't find project ${projectBoardName} in ${orgName} org`)
      return
    }
    
    robot.log.debug(`Fetched ${project.name} project (${project.id})`)
    
    // Fetch bounty-awaiting-approval column ID
    try {
      ghcolumns = await github.projects.getProjectColumns({ project_id: project.id })  
      
      const approvalColumnName = config['bounty-project-board']['awaiting-approval-column-name']
      const column = ghcolumns.data.find(c => c.name === approvalColumnName)
      if (!column) {
        robot.log.error(`Couldn't find ${approvalColumnName} column in project ${project.name}`)
        return
      }
      
      robot.log.debug(`Fetched ${column.name} column (${column.id})`)
    } catch (err) {
      robot.log.error(`Couldn't fetch the github columns for project: ${err}`, ownerName, repoName, project.id)
      return
    }
  } catch (err) {
    robot.log.error(`Couldn't fetch the github projects for repo: ${err}`, ownerName, repoName)
    return
  }
  
  // Create project card for the issue in the bounty-awaiting-approval column
  try {
    if (!process.env.DRY_RUN) {
      ghcard = await github.projects.createProjectCard({
        column_id: column.id,
        content_type: 'Issue',
        content_id: payload.issue.id
      })
    }
    
    robot.log.debug(`Created card: ${ghcard.data.url}`, ghcard.data.id)
    
    // Send message to Slack
    const slackHelper = require('../lib/slack')
    slackHelper.sendMessage(robot, slackClient, config.slack.notification.room, `Assigned issue to ${approvalColumnName} in ${projectBoardName} project\n${payload.issue.html_url}`)
  } catch (err) {
    robot.log.error(`Couldn't create project card for the issue: ${err}`, column.id, payload.issue.id)
  }
}
