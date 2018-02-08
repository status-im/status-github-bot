// Description:
//   Script that listens for issues with the label 'bounty-awaiting-approval'
//   and notifies the collaborators on Slack.
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//   probot-slack-status: "^0.2.2"
//
// Author:
//   Max Tyrrell (ImFeelingDucky/mac/yung_mac)

const Slack = require('probot-slack-status')
const getConfig = require('probot-config')

const defaultConfig = require('../lib/config')
const slackHelper = require('../lib/slack')

module.exports = (robot, getSlackMentionFromGitHubId) => {
  robot.log('Connected to bounty-awaiting-approval-slack-ping')

  Slack(robot, (slack) => {
    robot.log.trace('Connected to Slack')

    registerForNewBounties(robot, slack, getSlackMentionFromGitHubId)
  })
}

function registerForNewBounties (robot, slackClient, getSlackMentionFromGitHubId) {
  robot.on('issues.labeled', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) return null

    await notifyCollaborators(context, robot, slackClient, getSlackMentionFromGitHubId)
  })
}

async function notifyCollaborators (context, robot, slackClient, getSlackMentionFromGitHubId) {
  const { github, payload } = context
  const ownerName = payload.repository.owner.login
  const repoName = payload.repository.name
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const bountyProjectBoardConfig = config['bounty-project-board']

  if (!bountyProjectBoardConfig) {
    return
  }

  const watchedLabelName = bountyProjectBoardConfig['awaiting-approval-label-name']
  if (payload.label.name !== watchedLabelName) {
    robot.log.debug(`bountyAwaitingApprovalSlackPing - ${payload.label.name} doesn't match watched ${watchedLabelName} label. Ignoring`)
    return null
  }

  robot.log(`bountyAwaitingApprovalSlackPing - issue #${payload.issue.number} on ${ownerName}/${repoName} was labeled as a bounty awaiting approval. Pinging slack...`)

  const slackCollaborators = await getSlackCollaborators(ownerName, repoName, github, robot, getSlackMentionFromGitHubId)

  // Send message to Slack
  slackHelper.sendMessage(
    robot,
    slackClient,
    config.slack.notification.room,
    `New bounty awaiting approval: ${payload.issue.html_url}
/cc ${slackCollaborators.join(', ')}`
  )
}

// Get the Slack IDs of the collaborators of this repo.
async function getSlackCollaborators (owner, repo, github, robot, getSlackMentionFromGitHubId) {
  // Grab a list of collaborators to this repo, as an array of GitHub login usernames
  let collaborators = await github.repos.getCollaborators({owner, repo})
  collaborators = collaborators.data.map(collaboratorObject => collaboratorObject.login)

  // Create an array of Slack usernames from GitHub usernames
  return collaborators.map(getSlackMentionFromGitHubId).filter(id => id)
}
