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

function executeTemplate (templateString, templateVars) {
  let s = templateString

  for (const templateVar in templateVars) {
    if (templateVars.hasOwnProperty(templateVar)) {
      const value = templateVars[templateVar]

      s = s.replace(`{${templateVar}}`, value)
    }
  }

  return s
}

async function greetNewContributor (context, robot) {
  const { github, payload } = context
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const repoInfo = { owner: payload.repository.owner.login, repo: payload.repository.name }
  const prInfo = { ...repoInfo, number: payload.pull_request.number }

  const welcomeBotConfig = config ? config['welcome-bot'] : null
  if (!welcomeBotConfig) {
    return
  }

  robot.log(`${botName} - Handling Pull Request #${prInfo.number} on repo ${repoInfo.owner}/${repoInfo.repo}`)

  try {
    const ghissuesPayload = await github.issues.getForRepo({
      ...repoInfo,
      state: 'all',
      creator: payload.pull_request.user.login
    })

    const userPullRequests = ghissuesPayload.data.filter(issue => issue.pull_request)
    if (userPullRequests.length === 1) {
      try {
        const welcomeMessage = executeTemplate(welcomeBotConfig['message-template'], { user: payload.pull_request.user.login, 'pr-number': prInfo.number, 'repo-name': repoInfo.repo })

        if (process.env.DRY_RUN) {
          robot.log(`${botName} - Would have created comment in GHI`, prInfo, welcomeMessage)
        } else {
          await github.issues.createComment({
            ...prInfo,
            body: welcomeMessage
          })
        }

        // Send message to Slack
        slackHelper.sendMessage(robot, config.slack.notification.room, `Greeted ${payload.pull_request.user.login} on his first PR in the ${repoInfo.repo} repo\n${payload.pull_request.html_url}`)

        const slackRecipients = welcomeBotConfig['slack-recipients']
        if (slackRecipients) {
          for (const userID of slackRecipients) {
            await notifySlackRecipient(robot, userID, payload, repoInfo)
          }
        }
      } catch (err) {
        if (err.code !== 404) {
          robot.log.error(`${botName} - Couldn't create comment on PR: ${err}`, repoInfo)
        }
      }
    } else {
      robot.log.debug(`${botName} - This is not the user's first PR on the repo, ignoring`, repoInfo, payload.pull_request.user.login)
    }
  } catch (err) {
    robot.log.error(`${botName} - Couldn't fetch the user's github issues for repo: ${err}`, repoInfo)
  }
}

async function notifySlackRecipient (robot, userID, payload, repoInfo) {
  try {
    const resp = await robot.slackWeb.im.open(userID)

    const dmChannelID = resp.channel.id
    const msg = `Greeted ${payload.pull_request.user.login} on his first PR in the ${repoInfo.repo} repo\n${payload.pull_request.html_url}`

    robot.log.info(`${botName} - Opened DM Channel ${dmChannelID}`)
    robot.log.info(`Notifying ${userID} about user's first PM in ${payload.pull_request.url}`)

    robot.slackWeb.chat.postMessage(dmChannelID, msg, {unfurl_links: true, as_user: slackHelper.BotUserName})
  } catch (error) {
    robot.log.warn('Could not open DM channel for new user\'s first PM notification', error)
  }
}
