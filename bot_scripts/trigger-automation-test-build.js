// Description:
//   Script that listens for PRs moving into the 'TO TEST' column
//   and triggers a Jenkins build.
//
// Dependencies:
//   github: "^13.1.0"
//   jenkins: "^0.20.1"
//   probot-config: "^0.1.0"
//
// Author:
//   PombeirP

const getConfig = require('probot-config')
const jenkins = require('jenkins')({ baseUrl: process.env.JENKINS_URL, crumbIssuer: true, promisify: true })
const HashMap = require('hashmap')

const defaultConfig = require('../lib/config')
const gitHubHelpers = require('../lib/github-helpers')

const botName = 'trigger-automation-test-build'
const pendingPullRequests = new HashMap()

module.exports = (robot) => {
  if (!process.env.JENKINS_URL) {
    robot.log.info(`${botName} - Jenkins is not configured, not loading script`)
    return
  }

  setInterval(checkPendingPullRequests, 5 * 1000 * 60, robot)
  registerForRelevantCardEvents(robot)
}

function registerForRelevantCardEvents (robot) {
  robot.on(['project_card.created', 'project_card.moved'], context => processChangedProjectCard(robot, context))
}

async function processChangedProjectCard (robot, context) {
  const { github, payload } = context
  const repo = payload.repository
  if (!repo) {
    robot.log.debug(`${botName} - Repository info is not present in payload, ignoring`)
    return
  }

  const repoInfo = context.repo()
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const projectBoardConfig = config ? config['project-board'] : null
  const automatedTestsConfig = config ? config['automated-tests'] : null
  if (!projectBoardConfig || !automatedTestsConfig) {
    return
  }

  if (payload.project_card.note) {
    robot.log.trace(`${botName} - Card is a note, ignoring`)
    return
  }

  const projectBoardName = projectBoardConfig['name']
  const testColumnName = projectBoardConfig['test-column-name']

  if (repo.full_name !== automatedTestsConfig['repo-full-name']) {
    robot.log.trace(`${botName} - Pull request project doesn't match watched repo, exiting`, repo.full_name, automatedTestsConfig['repo-full-name'])
    return
  }

  let inTestColumn
  try {
    const columnPayload = await github.projects.getProjectColumn({ id: payload.project_card.column_id })

    if (columnPayload.data.name !== testColumnName) {
      robot.log.trace(`${botName} - Card column name doesn't match watched column name, exiting`, columnPayload.data.name, testColumnName)
      return
    }

    inTestColumn = columnPayload.data
  } catch (error) {
    robot.log.warn(`${botName} - Error while fetching project column`, payload.project_card.column_id, error)
    return
  }

  const last = (a, index) => {
    return a[a.length + index]
  }

  try {
    const projectId = last(inTestColumn.project_url.split('/'), -1)
    const projectPayload = await github.projects.getProject({ id: projectId })
    const project = projectPayload.data
    if (project.name !== projectBoardName) {
      robot.log.trace(`${botName} - Project board name doesn't match watched project board, exiting`, project.name, projectBoardName)
      return
    }
  } catch (error) {
    robot.log.warn(`${botName} - Error while fetching project column`, payload.project_card.column_id, error)
    return
  }

  const prNumber = last(payload.project_card.content_url.split('/'), -1)
  const fullJobName = automatedTestsConfig['job-full-name']

  await processPullRequest(context, robot, { ...repoInfo, number: prNumber }, fullJobName)
}

async function processPullRequest (context, robot, prInfo, fullJobName) {
  const { github } = context

  // Remove the PR from the pending PR list, if it is there
  pendingPullRequests.delete(prInfo.number)

  try {
    // Get detailed pull request
    const pullRequestPayload = await github.pullRequests.get(prInfo)
    const pullRequest = pullRequestPayload.data
    if (!pullRequest) {
      robot.log.warn(`${botName} - Could not find PR`, prInfo)
      return
    }

    const statusContext = 'jenkins/prs/android-e2e'
    const currentStatus = await gitHubHelpers.getPullRequestCurrentStatusForContext(context, statusContext, pullRequest)

    switch (currentStatus) {
      case 'pending':
        pendingPullRequests.set(prInfo.number, { github: github, prInfo, fullJobName: fullJobName })
        robot.log.debug(`${botName} - Status for ${statusContext} is '${currentStatus}', adding to backlog to check periodically`, prInfo)
        return
      case 'error':
      case 'failure':
        robot.log.debug(`${botName} - Status for ${statusContext} is '${currentStatus}', exiting`, prInfo)
        return
      case 'success':
        robot.log.debug(`${botName} - Status for ${statusContext} is '${currentStatus}', proceeding`, prInfo)
        break
      default:
        robot.log.warn(`${botName} - Status for ${statusContext} is '${currentStatus}', ignoring`, prInfo)
        return
    }
  } catch (err) {
    robot.log.error(`Couldn't calculate the PR approval state: ${err}`, prInfo)
    return
  }

  try {
    const args = { parameters: { pr_id: prInfo.number, apk: `--apk=${prInfo.number}.apk` } }

    if (process.env.DRY_RUN) {
      robot.log(`${botName} - Would start ${fullJobName} job in Jenkins`, prInfo, args)
    } else {
      robot.log(`${botName} - Starting ${fullJobName} job in Jenkins`, prInfo, args)
      const buildId = await jenkins.job.build(fullJobName, args)
      robot.log(`${botName} - Started job in Jenkins`, prInfo, buildId)
    }
  } catch (error) {
    robot.log.error(`${botName} - Error while triggering Jenkins build. Will retry later`, prInfo, error)

    pendingPullRequests.set(prInfo.number, { github: github, prInfo: prInfo, fullJobName: fullJobName })
  }
}

async function checkPendingPullRequests (robot) {
  const _pendingPullRequests = pendingPullRequests.clone()

  robot.log.trace(`${botName} - Processing ${_pendingPullRequests.size} pending PRs`)

  for (const { github, prInfo, fullJobName } of _pendingPullRequests.values()) {
    await processPullRequest(github, robot, prInfo, fullJobName)
  }

  robot.log.trace(`${botName} - Finished processing ${_pendingPullRequests.size} pending PRs`)
}
