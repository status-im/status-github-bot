// Description:
//   Script that listens to new GitHub pull requests
//   and assigns them to the REVIEW column on the 'Pipeline for QA' project
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//
// Author:
//   PombeirP

const defaultConfig = require('../lib/config')
const slackHelper = require('../lib/slack')
const gitHubHelpers = require('../lib/github-helpers')

const getConfig = require('probot-config')

const botName = 'assign-new-pr-to-review'

module.exports = (robot) => {
  robot.on('pull_request.opened', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return }

    // A new PR was opened
    await assignPullRequestToReview(context, robot)
  })
}

async function assignPullRequestToReview (context, robot) {
  const { github, payload } = context
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const repoInfo = { owner: payload.repository.owner.login, repo: payload.repository.name }
  const prNumber = payload.pull_request.number

  const projectBoardConfig = config ? config['project-board'] : null
  if (!projectBoardConfig) {
    return
  }

  robot.log(`${botName} - Handling Pull Request #${prNumber} on repo ${repoInfo.owner}/${repoInfo.repo}`)

  const projectBoardName = projectBoardConfig.name
  const reviewColumnName = projectBoardConfig['review-column-name']
  // Find 'Pipeline for QA' project
  const project = await gitHubHelpers.getRepoProjectByName(github, robot, repoInfo, projectBoardName, botName)
  // Fetch REVIEW column ID
  const column = await gitHubHelpers.getProjectColumnByName(github, robot, project, reviewColumnName, botName)
  if (!column) {
    return
  }

  // Create project card for the PR in the REVIEW column
  try {
    if (process.env.DRY_RUN) {
      robot.log.debug(`${botName} - Would have created card`, column.id, payload.pull_request.id)
    } else {
      const ghcardPayload = await github.projects.createProjectCard({
        column_id: column.id,
        content_type: 'PullRequest',
        content_id: payload.pull_request.id
      })

      robot.log.debug(`${botName} - Created card: ${ghcardPayload.data.url}`, ghcardPayload.data.id)
    }

    // Send message to Slack
    slackHelper.sendMessage(robot, config.slack.notification.room, `Assigned PR to ${reviewColumnName} in ${projectBoardName} project\n${payload.pull_request.html_url}`)
  } catch (err) {
    robot.log.error(`${botName} - Couldn't create project card for the PR: ${err}`, column.id, payload.pull_request.id)
  }
}
