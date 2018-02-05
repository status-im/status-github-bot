// Description:
//   Script that listens to new GitHub pull requests
//   and assigns them to the REVIEW column on the 'Pipeline for QA' project
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

  robot.on('pull_request.opened', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return }

    // A new PR was opened
    await assignPullRequestToReview(context, robot)
  })
}

async function assignPullRequestToReview (context, robot) {
  const payload = context.payload
  const github = context.github
  // const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const config = defaultConfig(robot, '.github/github-bot.yml')
  const ownerName = payload.repository.owner.login
  const repoName = payload.repository.name
  const prNumber = payload.pull_request.number

  const projectBoardConfig = config['project-board']
  if (!projectBoardConfig) {
    return
  }

  robot.log(`assignPullRequestToReview - Handling Pull Request #${prNumber} on repo ${ownerName}/${repoName}`)

  // Fetch repo projects
  // TODO: The repo project and project column info should be cached
  // in order to improve performance and reduce roundtrips
  let column = null
  const projectBoardName = projectBoardConfig.name
  const reviewColumnName = projectBoardConfig['review-column-name']
  try {
    const ghprojects = await github.projects.getRepoProjects({
      owner: ownerName,
      repo: repoName,
      state: 'open'
    })

    // Find 'Pipeline for QA' project
    const project = ghprojects.data.find(p => p.name === projectBoardName)
    if (!project) {
      robot.log.error(`Couldn't find project ${projectBoardName} in repo ${ownerName}/${repoName}`)
      return
    }

    robot.log.debug(`Fetched ${project.name} project (${project.id})`)

    // Fetch REVIEW column ID
    try {
      const ghcolumns = await github.projects.getProjectColumns({ project_id: project.id })

      column = ghcolumns.data.find(c => c.name === reviewColumnName)
      if (!column) {
        robot.log.error(`Couldn't find ${reviewColumnName} column in project ${project.name}`)
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

  // Create project card for the PR in the REVIEW column
  try {
    if (process.env.DRY_RUN) {
      robot.log.debug('Would have created card', column.id, payload.pull_request.id)
    } else {
      const ghcard = await github.projects.createProjectCard({
        column_id: column.id,
        content_type: 'PullRequest',
        content_id: payload.pull_request.id
      })

      robot.log.debug(`Created card: ${ghcard.data.url}`, ghcard.data.id)
    }

    // Send message to Slack
    const slackHelper = require('../lib/slack')
    slackHelper.sendMessage(robot, slackClient, config.slack.notification.room, `Assigned PR to ${reviewColumnName} in ${projectBoardName} project\n${payload.pull_request.html_url}`)
  } catch (err) {
    robot.log.error(`Couldn't create project card for the PR: ${err}`, column.id, payload.pull_request.id)
  }
}
