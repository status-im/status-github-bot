// Description:
//   Script that listens for new Review Requests and notifies reviewers on Slack
//
// Dependencies:
//   @slack/client: ""
//
// Author:
//   Martin Klepsch (martinklepsch)

const { WebClient } = require('@slack/client')
const slackWeb = new WebClient(process.env.SLACK_BOT_TOKEN)
const botName = 'notify-reviewers-via-slack'
const botUserName = 'probot'

module.exports = (robot, getSlackIdFromGitHubId) => {
  robot.log(`${botName} - Starting...`)
  registerForNewReviewRequests(robot, getSlackIdFromGitHubId)
}

function registerForNewReviewRequests (robot, getSlackIdFromGitHubId) {
  robot.on('pull_request.review_requested', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) return null

    await notifyReviewers(context, robot, getSlackIdFromGitHubId)
  })
}

async function notifyReviewers (context, robot, getSlackIdFromGitHubId) {
  const { payload } = context

  for (let reviewer of payload.pull_request.requested_reviewers) {
    const userID = getSlackIdFromGitHubId(reviewer.login)

    if (userID === undefined) {
      robot.log.warn('Could not find Slack ID for GitHub user', reviewer.login)
    } else {
      slackWeb.im.open(userID).then((resp) => {
        const dmChannelID = resp.channel.id
        const octoboxNote = 'For more powerful management of GitHub notifications also check out https://octobox.io/'
        const msg = `New Pull Request awaiting review: ${payload.pull_request.html_url}\n${octoboxNote}`

        robot.log.info(`${botName} - Opened DM Channel ${dmChannelID}`)
        robot.log.info(`Notifying ${userID} about review request in ${payload.pull_request.url}`)

        slackWeb.chat.postMessage(dmChannelID, msg, {unfurl_links: true, as_user: botUserName})
      }).catch(error => robot.log.error('Could not open DM channel for review request notification', error))
    }
  }
}
