// Description:
//   Script that listens to new labels on GitHub issues
//   and assigns the issues to the bounty-awaiting-approval column on the 'Status SOB Swarm' project
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//   probot-slack-status: "^0.2.2"
//
// Author:
//   PombeirP

// const getConfig = require('probot-config')
const defaultConfig = require('../lib/config')
const Slack = require('probot-slack-status')

let slackClient = null

module.exports = (robot) => {
  // robot.on('slack.connected', ({ slack }) => {
  Slack(robot, (slack) => {
    robot.log.trace('Connected, assigned slackClient')
    slackClient = slack
  })

  robot.on('issues.labeled', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return }

    // A new issue was labeled
    await assignIssueToBountyAwaitingForApproval(context, robot, true)
  })
  robot.on('issues.unlabeled', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return }

    // An issue was unlabeled
    await assignIssueToBountyAwaitingForApproval(context, robot, false)
  })
}

async function assignIssueToBountyAwaitingForApproval (context, robot, assign) {
  const github = context.github
  const payload = context.payload
  const ownerName = payload.repository.owner.login
  const repoName = payload.repository.name
  // const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const config = defaultConfig(robot, '.github/github-bot.yml')

  if (!config['bounty-project-board']) {
    return
  }

  const watchedLabelName = config['bounty-project-board']['label-name']
  if (payload.label.name !== watchedLabelName) {
    robot.log.debug(`assignIssueToBountyAwaitingForApproval - ${payload.label.name} doesn't match watched ${watchedLabelName} label. Ignoring`)
    return
  }

  if (assign) {
    robot.log(`assignIssueToBountyAwaitingForApproval - Handling labeling of #${payload.issue.number} with ${payload.label.name} on repo ${ownerName}/${repoName}`)
  } else {
    robot.log(`assignIssueToBountyAwaitingForApproval - Handling unlabeling of #${payload.issue.number} with ${payload.label.name} on repo ${ownerName}/${repoName}`)
  }

  // Fetch org projects
  // TODO: The org project and project column info should be cached
  // in order to improve performance and reduce roundtrips
  let column = null
  const projectBoardName = config['bounty-project-board'].name
  const approvalColumnName = config['bounty-project-board']['awaiting-approval-column-name']
  try {
    const orgName = ownerName

    const ghprojects = await github.projects.getOrgProjects({
      org: orgName,
      state: 'open'
    })

    // Find 'Status SOB Swarm' project
    const project = ghprojects.data.find(p => p.name === projectBoardName)
    if (!project) {
      robot.log.error(`Couldn't find project ${projectBoardName} in ${orgName} org`)
      return
    }

    robot.log.debug(`Fetched ${project.name} project (${project.id})`)

    // Fetch bounty-awaiting-approval column ID
    try {
      const ghcolumns = await github.projects.getProjectColumns({ project_id: project.id })

      column = ghcolumns.data.find(c => c.name === approvalColumnName)
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

  let ghcard = null
  if (process.env.DRY_RUN) {
    if (assign) {
      robot.log.info(`Would have created card for issue`, column.id, payload.issue.id)
    } else {
      robot.log.info(`Would have deleted card for issue`, column.id, payload.issue.id)
    }
  } else {
    if (assign) {
      try {
        // Create project card for the issue in the bounty-awaiting-approval column
        ghcard = await github.projects.createProjectCard({
          column_id: column.id,
          content_type: 'Issue',
          content_id: payload.issue.id
        })
        ghcard = ghcard.data

        robot.log(`Created card: ${ghcard.url}`, ghcard.id)
      } catch (err) {
        robot.log.error(`Couldn't create project card for the issue: ${err}`, column.id, payload.issue.id)
      }
    } else {
      try {
        ghcard = await getProjectCardForIssue(github, column.id, payload.issue.url)
        if (ghcard) {
          await github.projects.deleteProjectCard({id: ghcard.id})
          robot.log(`Deleted card: ${ghcard.url}`, ghcard.id)
        }
      } catch (err) {
        robot.log.error(`Couldn't delete project card for the issue: ${err}`, column.id, payload.issue.id)
      }
    }
  }

  if (!process.env.DRY_RUN_BOUNTY_APPROVAL) {
    // Send message to Slack
    const slackHelper = require('../lib/slack')
    if (assign) {
      slackHelper.sendMessage(robot, slackClient, config.slack.notification.room, `Assigned issue to ${approvalColumnName} in ${projectBoardName} project\n${payload.issue.html_url}`)
    } else {
      slackHelper.sendMessage(robot, slackClient, config.slack.notification.room, `Unassigned issue from ${approvalColumnName} in ${projectBoardName} project\n${payload.issue.html_url}`)
    }
  }
}

async function getProjectCardForIssue (github, columnId, issueUrl) {
  const ghcards = await github.projects.getProjectCards({column_id: columnId})
  const ghcard = ghcards.data.find(c => c.content_url === issueUrl)

  return ghcard
}
