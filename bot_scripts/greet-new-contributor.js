// Description:
//   Script that listens to new GitHub pull requests
//   and greets the user if it is their first PR on the repo
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//
// Author:
//   PombeirP

const getConfig = require('probot-config')

const slackHelper = require('../lib/slack')
const defaultConfig = require('../lib/config')

const botName = 'greet-new-contributor'

module.exports = (robot) => {
  robot.on('pull_request.opened', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return }

    // A new PR was opened
    await greetNewContributor(context, robot)
  })
}

async function greetNewContributor (context, robot) {
  const { github, payload } = context
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const ownerName = payload.repository.owner.login
  const repoName = payload.repository.name
  const prNumber = payload.pull_request.number

  const welcomeBotConfig = config ? config['welcome-bot'] : null
  if (!welcomeBotConfig) {
    return
  }

  robot.log(`${botName} - Handling Pull Request #${prNumber} on repo ${ownerName}/${repoName}`)

  try {
    const ghissuesPayload = await github.issues.getForRepo({
      owner: ownerName,
      repo: repoName,
      state: 'all',
      creator: payload.pull_request.user.login
    })

    const userPullRequests = ghissuesPayload.data.filter(issue => issue.pull_request)
    if (userPullRequests.length === 1) {
      try {
        const welcomeMessage = welcomeBotConfig.message
        if (process.env.DRY_RUN) {
          robot.log(`${botName} - Would have created comment in GHI`, ownerName, repoName, prNumber, welcomeMessage)
        } else {
          await github.issues.createComment({
            owner: ownerName,
            repo: repoName,
            number: prNumber,
            body: welcomeMessage
          })
        }

        // Send message to Slack
        slackHelper.sendMessage(robot, config.slack.notification.room, `Greeted ${payload.pull_request.user.login} on his first PR in the ${repoName} repo\n${payload.pull_request.html_url}`)
      } catch (err) {
        if (err.code !== 404) {
          robot.log.error(`${botName} - Couldn't create comment on PR: ${err}`, ownerName, repoName)
        }
      }
    } else {
      robot.log.debug(`${botName} - This is not the user's first PR on the repo, ignoring`, ownerName, repoName, payload.pull_request.user.login)
    }
  } catch (err) {
    robot.log.error(`${botName} - Couldn't fetch the user's github issues for repo: ${err}`, ownerName, repoName)
  }
}
