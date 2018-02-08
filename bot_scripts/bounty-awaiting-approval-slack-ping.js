// Description:
//   Script that listens for issues with the label 'bounty-awaiting-approval'
//   and notifies the collaborators on Slack.
//
// Dependencies:
//   github: "^13.1.0"
//   hashset: "0.0.6"
//   probot-config: "^0.1.0"
//   probot-slack-status: "^0.2.2"
//
// Author:
//   Max Tyrrell (ImFeelingDucky/mac/yung_mac)

const Slack = require('probot-slack-status')
const getConfig = require('probot-config')
const HashSet = require('hashset')

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
  const bountyProjectBoardConfig = config ? config['bounty-project-board'] : null
  const gitHubTeamConfig = config ? config['github-team'] : null

  if (!bountyProjectBoardConfig) {
    robot.log.debug(`Bounty project board not configured in repo ${ownerName}/${repoName}, ignoring`)
    return
  }

  if (!gitHubTeamConfig) {
    robot.log.debug(`GitHub team not configured in repo ${ownerName}/${repoName}, ignoring`)
    return
  }

  const watchedLabelName = bountyProjectBoardConfig['awaiting-approval-label-name']
  if (payload.label.name !== watchedLabelName) {
    robot.log.debug(`bountyAwaitingApprovalSlackPing - ${payload.label.name} doesn't match watched ${watchedLabelName} label. Ignoring`)
    return null
  }

  robot.log(`bountyAwaitingApprovalSlackPing - issue #${payload.issue.number} on ${ownerName}/${repoName} was labeled as a bounty awaiting approval. Pinging slack...`)

  const slackCollaborators = await getSlackCollaborators(ownerName, repoName, github, robot, gitHubTeamConfig, getSlackMentionFromGitHubId)

  // Mention the project board owner as well, if configured
  const bountyProjectBoardOwner = bountyProjectBoardConfig['owner']
  if (bountyProjectBoardOwner) {
    const slackUserMention = getSlackMentionFromGitHubId(bountyProjectBoardOwner)
    if (slackUserMention) {
      slackCollaborators.push(slackUserMention)
    }
  }

  // Send message to Slack
  slackHelper.sendMessage(
    robot,
    slackClient,
    config.slack.notification.room,
    `New bounty awaiting approval: ${payload.issue.html_url}
/cc ${slackCollaborators.values().join(', ')}`
  )
}

function randomInt (low, high) {
  return Math.floor(Math.random() * (high - low) + low)
}

// Get the Slack IDs of the collaborators of this repo.
async function getSlackCollaborators (ownerName, repoName, github, robot, gitHubTeamConfig, getSlackMentionFromGitHubId) {
  const teamSlug = gitHubTeamConfig['slug']
  if (!teamSlug) {
    robot.log.debug(`GitHub team slug not configured in repo ${ownerName}/${repoName}, ignoring`)
    return
  }

  // Grab a list of collaborators to this repo, as an array of GitHub login usernames
  const teams = await github.paginate(github.orgs.getTeams({org: ownerName}), res => res.data)
  const team = teams.find(t => t.slug === teamSlug)
  if (!team) {
    robot.log.debug(`bountyAwaitingApprovalSlackPing - GitHub team with slug ${teamSlug} was not found. Ignoring`)
    return
  }

  const teamMembers = await github.paginate(github.orgs.getTeamMembers({id: team.id, per_page: 100}), res => res.data)

  // Create an array of Slack usernames from GitHub usernames
  const slackUsers = teamMembers.map(u => u.login).map(getSlackMentionFromGitHubId).filter(id => id)
  const randomTeamMemberLimit = 2
  const selectedSlackUsers = new HashSet()

  while (selectedSlackUsers.length < randomTeamMemberLimit || selectedSlackUsers.length < slackUsers.length) {
    const slackUser = slackUsers[randomInt(0, slackUsers.length)]
    selectedSlackUsers.add(slackUser)
  }

  return selectedSlackUsers
}
