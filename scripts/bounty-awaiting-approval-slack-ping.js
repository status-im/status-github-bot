// Description:
//   Script that listens for issues with the label 'bounty-awaiting-approval'
//   and notifies the team members on Slack.
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//   probot-slack-status: "^0.2.2"
//
// Author:
//   Max Tyrrell (ImFeelingDucky/mac/yung_mac)

const defaultConfig = require('../lib/config')
const Slack = require('probot-slack-status')

module.exports = (robot) => {
  robot.log('Connected to bounty-awaiting-approval-slack-ping')

  Slack(robot, (slack) => {
    robot.log.trace('Connected to Slack')

    checkForNewBounties(robot, slack)
  })
}

function checkForNewBounties (robot, slackClient) {
  robot.on('issues.labeled', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) return null

    await notifyCollaborators(context, robot, slackClient)
  })
}

async function notifyCollaborators (context, robot, slackClient) {
  const { github, payload } = context
  const ownerName = payload.repository.owner.login
  const repoName = payload.repository.name
  const config = defaultConfig(robot, '.github/github-bot.yml')
  const gitHubToSlackUsernames = defaultConfig(robot, '.github/collaborators.yml').slack

  if (!config['bounty-project-board']) return null

  const watchedLabelName = config['bounty-awaiting-approval-slack-ping']['label-name']
  if (payload.label.name !== watchedLabelName) {
    robot.log.debug(`bountyAwaitingApprovalSlackPing - ${payload.label.name} doesn't match watched ${watchedLabelName} label. Ignoring`)
    return null
  }

  robot.log(`bountyAwaitingApprovalSlackPing - issue #${payload.issue.number} on ${ownerName}/${repoName} was labeled as a bounty awaiting approval. Pinging slack...`)

  // Grab a list of collaborators to this repo, as an array of login usernames
  let collaborators = await github.repos.getCollaborators({owner: ownerName, repo: repoName})
  collaborators = collaborators.data.map(collaboratorObject => collaboratorObject.login)

  // Filter down to exclude non-collaborators to this repo
  const slackCollaborators = Object.keys(gitHubToSlackUsernames)
    .filter(collaborator => collaborators.includes(collaborator))
    .map(gitHubUsername => gitHubToSlackUsernames[gitHubUsername])

  if (process.env.DRY_RUN) {
    robot.log(
    `Would have sent a message on Slack to ${config.slack.notification.room} saying: \n` +
    `New bounty awaiting approval: [#${payload.issue.number} - ${payload.issue.title}](${payload.issue.html_url})
@${slackCollaborators.join(', @')}`
    )

    return null
  }

  // Send message to Slack
  const slackHelper = require('../lib/slack')
  slackHelper.sendMessage(
    robot,
    slackClient,
    config.slack.notification.room,
    `New bounty awaiting approval: [#${payload.issue.number} - ${payload.issue.title}](${payload.issue.html_url})
@${slackCollaborators.join(', @')}`
  )
}
