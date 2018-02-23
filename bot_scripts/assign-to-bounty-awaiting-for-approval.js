// Description:
//   Script that listens to new labels on GitHub issues
//   and assigns the issues to the bounty-awaiting-approval column on the 'Status SOB Swarm' project
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//
// Author:
//   PombeirP

const slackHelper = require('../lib/slack')
const gitHubHelpers = require('../lib/github-helpers')
const defaultConfig = require('../lib/config')

const getConfig = require('probot-config')

const botName = 'assign-to-bounty-awaiting-for-approval'

module.exports = (robot) => {
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
  const { github, payload } = context
  const repoInfo = { owner: payload.repository.owner.login, repo: payload.repository.name }
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const projectBoardConfig = config ? config['bounty-project-board'] : null

  if (!projectBoardConfig) {
    return
  }

  const watchedLabelName = projectBoardConfig['awaiting-approval-label-name']
  if (payload.label.name !== watchedLabelName) {
    robot.log.debug(`${botName} - ${payload.label.name} doesn't match watched ${watchedLabelName} label. Ignoring`)
    return
  }

  if (assign) {
    robot.log(`${botName} - Handling labeling of #${payload.issue.number} with ${payload.label.name} on repo ${repoInfo.owner}/${repoInfo.repo}`)
  } else {
    robot.log(`${botName} - Handling unlabeling of #${payload.issue.number} with ${payload.label.name} on repo ${repoInfo.owner}/${repoInfo.repo}`)
  }

  // Fetch bounty-awaiting-approval column in project board
  const approvalColumnName = projectBoardConfig['awaiting-approval-column-name']
  const project = await gitHubHelpers.getOrgProjectByName(github, robot, repoInfo.owner, projectBoardConfig.name, botName)
  const column = await gitHubHelpers.getProjectColumnByName(github, robot, project, approvalColumnName, botName)
  if (!column) {
    return
  }

  const bountyLabelName = projectBoardConfig['bounty-label-name']
  const isOfficialBounty = !!payload.issue.labels.find(l => l.name === bountyLabelName)
  const bountySize = getBountySize(payload.issue.labels, projectBoardConfig)

  if (process.env.DRY_RUN) {
    if (assign) {
      robot.log.info(`${botName} - Would have created card for issue`, column.id, payload.issue.id)
    } else {
      robot.log.info(`${botName} - Would have deleted card for issue`, column.id, payload.issue.id)
    }
  } else {
    if (assign) {
      try {
        // Create project card for the issue in the bounty-awaiting-approval column
        const ghcardPayload = await github.projects.createProjectCard({
          column_id: column.id,
          content_type: 'Issue',
          content_id: payload.issue.id
        })
        const ghcard = ghcardPayload.data

        robot.log(`${botName} - Created card: ${ghcard.url}`, ghcard.id)
      } catch (err) {
        robot.log.error(`${botName} - Couldn't create project card for the issue: ${err}`, column.id, payload.issue.id)
      }
    } else {
      try {
        const ghcard = await gitHubHelpers.getProjectCardForIssue(github, column.id, payload.issue.url)
        if (ghcard) {
          await github.projects.deleteProjectCard({id: ghcard.id})
          robot.log(`${botName} - Deleted card: ${ghcard.url}`, ghcard.id)
        }
      } catch (err) {
        robot.log.error(`${botName} - Couldn't delete project card for the issue: ${err}`, column.id, payload.issue.id)
      }
    }
  }

  const slackMessage = getSlackMessage(projectBoardConfig.name, approvalColumnName, payload, assign, isOfficialBounty, bountySize)
  if (slackMessage && !process.env.DRY_RUN_BOUNTY_APPROVAL) {
    // Send message to Slack
    slackHelper.sendMessage(robot, config.slack.notification.room, slackMessage)

    // Cross-post approved bounties to a predefined room
    if (!assign && isOfficialBounty) {
      const slackRoom = projectBoardConfig['post-approved-bounties-to-slack-room']
      if (slackRoom) {
        slackHelper.sendMessage(robot, slackRoom, slackMessage)
      }
    }
  }
}

function getSlackMessage (projectBoardName, approvalColumnName, payload, assign, isOfficialBounty, bountySize) {
  if (assign) {
    return `Assigned issue to ${approvalColumnName} in ${projectBoardName} project\n${payload.issue.html_url}`
  }

  if (!isOfficialBounty) {
    return `Unassigned issue from ${approvalColumnName} in ${projectBoardName} project\n${payload.issue.html_url}`
  }

  if (bountySize) {
    return `${payload.issue.html_url} has been approved as an official bounty (size: ${bountySize})!`
  }
  return `${payload.issue.html_url} has been approved as an official bounty!`
}

function getBountySize (labels, projectBoardConfig) {
  const regexString = projectBoardConfig['bounty-size-label-name-regex']
  if (!regexString) {
    return null
  }

  const bountySizeLabelRegex = new RegExp(regexString)

  const match = labels.map(l => bountySizeLabelRegex.exec(l.name)).find(m => m != null)
  if (match) {
    return match[1]
  }

  return null
}
