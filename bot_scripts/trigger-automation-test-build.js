// Description:
//   Script that listens for PRs moving into the 'TO TEST' column
//   and triggers a Jenkins build.
//
// Dependencies:
//   github: "^13.1.0"
//   jenkins: "^0.20.1"
//   probot-config: "^1.0.0"
//
// Author:
//   PombeirP

const getConfig = require('probot-config')
const createScheduler = require('probot-scheduler')
const jenkins = require('jenkins')({ baseUrl: process.env.JENKINS_URL, crumbIssuer: true, promisify: true })
const HashMap = require('hashmap')
const HashSet = require('hashset')

const defaultConfig = require('../lib/config')
const gitHubHelpers = require('../lib/github-helpers')

const botName = 'trigger-automation-test-build'
const pendingPullRequests = new HashMap()

const existingProjectsProcessed = new HashSet()

module.exports = (robot) => {
  if (!process.env.JENKINS_URL) {
    robot.log.info(`${botName} - Jenkins is not configured, not loading script`)
    return
  }

  robot.log.info(`${botName} - Starting up`)

  const { stop } = createScheduler(robot, { interval: 1 * 60 * 1000, delay: false })
  robot.on('schedule.repository', context => processExistingProjectCards(robot, context, stop))

  setInterval(checkPendingPullRequests, 5 * 1000 * 60, robot)
  registerForRelevantCardEvents(robot)
}

function registerForRelevantCardEvents (robot) {
  robot.on(['project_card.created', 'project_card.moved'], context => processChangedProjectCard(robot, context, undefined))
}

const last = (a, index) => {
  return a[a.length + index]
}

async function processExistingProjectCards (robot, context, stopScheduler) {
  stopScheduler(context.payload.repository)

  if (existingProjectsProcessed.contains(context.payload.repository.id)) {
    return
  }

  existingProjectsProcessed.add(context.payload.repository.id)

  const { github } = context
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const projectBoardConfig = config ? config['project-board'] : null
  const automatedTestsConfig = config ? config['automated-tests'] : null
  if (!projectBoardConfig || !automatedTestsConfig) {
    return
  }

  const repoInfo = context.repo()
  const projectBoardName = projectBoardConfig['name']
  const kickoffColumnName = automatedTestsConfig['kickoff-column-name']

  // Find 'Pipeline for QA' project
  const project = await gitHubHelpers.getRepoProjectByName(github, robot, repoInfo, projectBoardName, botName)
  if (!project) {
    robot.log.trace(`${botName} - Project doesn't have the specified project board`, repoInfo, projectBoardName)
    return
  }

  const allColumns = await github.paginate(
    github.projects.listColumns({ project_id: project.id }),
    res => res.data
  )
  const kickoffColumn = allColumns.find(c => c.name === kickoffColumnName)
  if (!kickoffColumn) {
    robot.log.debug(`${botName} - Kickoff column not found in project`, kickoffColumnName, allColumns, projectBoardName)
    return
  }

  const columnCards = await github.paginate(
    github.projects.listCards({ column_id: kickoffColumn.id }),
    res => res.data
  )
  robot.log.debug(`${botName} - Fetched ${columnCards.length} cards`, columnCards)
  for (const { url } of columnCards) {
    try {
      const cardId = last(url.split('/'), -1)
      const { data: card } = await github.projects.getCard({ card_id: cardId })
      await processChangedProjectCard(robot, context, { ...card, column_id: kickoffColumn.id })
    } catch (err) {
      robot.log.error(`${botName} - Unhandled exception while processing card: ${err}`, url)
    }
  }
}

async function processChangedProjectCard (robot, context, card) {
  const { github, payload } = context
  const repo = payload.repository
  const repoInfo = context.repo()
  if (!repoInfo.repo) {
    robot.log.debug(`${botName} - Repository info is not present in payload, ignoring`, context)
    return
  }
  if (!card) {
    card = payload.project_card
  }

  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const projectBoardConfig = config ? config['project-board'] : null
  const automatedTestsConfig = config ? config['automated-tests'] : null
  if (!projectBoardConfig || !automatedTestsConfig) {
    return
  }

  robot.log.debug(`${botName} - Processing changed project card`, card)

  if (card.note) {
    robot.log.trace(`${botName} - Card is a note, ignoring`)
    return
  }

  const projectBoardName = projectBoardConfig['name']
  const kickoffColumnName = automatedTestsConfig['kickoff-column-name']

  if (repo.full_name !== automatedTestsConfig['repo-full-name']) {
    robot.log.trace(`${botName} - Pull request project doesn't match watched repo, exiting`, repo.full_name, automatedTestsConfig['repo-full-name'])
    return
  }

  let targetKickoffColumn
  try {
    const columnPayload = await github.projects.getColumn({ column_id: card.column_id })

    if (columnPayload.data.name !== kickoffColumnName) {
      robot.log.trace(`${botName} - Card column name doesn't match watched column name, exiting`, columnPayload.data.name, kickoffColumnName)
      return
    }

    targetKickoffColumn = columnPayload.data
  } catch (error) {
    robot.log.warn(`${botName} - Error while fetching project column`, card.column_id, error)
    return
  }

  try {
    const projectId = last(targetKickoffColumn.project_url.split('/'), -1)
    const projectPayload = await github.projects.get({ project_id: projectId })
    const project = projectPayload.data
    if (project.name !== projectBoardName) {
      robot.log.trace(`${botName} - Project board name doesn't match watched project board, exiting`, project.name, projectBoardName)
      return
    }
  } catch (error) {
    robot.log.warn(`${botName} - Error while fetching project column`, card.column_id, error)
    return
  }

  const prNumber = last(card.content_url.split('/'), -1)
  const fullJobName = automatedTestsConfig['job-full-name']

  await processPullRequest(context, robot, { ...repoInfo, number: prNumber }, fullJobName)
}

async function processPullRequest (context, robot, prInfo, fullJobName) {
  const { github } = context

  // Remove the PR from the pending PR list, if it is there
  pendingPullRequests.delete(prInfo.number)
  robot.log.debug(`${botName} - Removed PR #${prInfo.number} from queue, current queue length is ${pendingPullRequests.size}`)

  try {
    // Get detailed pull request
    const pullRequestPayload = await github.pullRequests.get(prInfo)
    const pullRequest = pullRequestPayload.data
    if (!pullRequest) {
      robot.log.warn(`${botName} - Could not find PR`, prInfo)
      return
    }
    if (pullRequest.state === 'closed') {
      robot.log.info(`${botName} - PR is closed, discarded`, prInfo)
      return
    }

    const statusContext = 'jenkins/prs/android-e2e'
    const currentStatus = await gitHubHelpers.getPullRequestCurrentStatusForContext(context, statusContext, pullRequest)

    switch (currentStatus) {
      case undefined:
      case 'pending':
      case 'failure':
        pendingPullRequests.set(prInfo.number, { context: context, prInfo, fullJobName: fullJobName })
        robot.log.debug(`${botName} - Status for ${statusContext} is '${currentStatus}', adding to backlog to check periodically, current queue length is ${pendingPullRequests.size}`, prInfo)
        return
      case 'error':
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
    const args = { parameters: { PR_ID: prInfo.number, APK_NAME: `${prInfo.number}.apk` } }

    if (process.env.DRY_RUN) {
      robot.log(`${botName} - Would start ${fullJobName} job in Jenkins`, prInfo, args)
    } else {
      robot.log(`${botName} - Starting ${fullJobName} job in Jenkins`, prInfo, args)
      const buildId = await jenkins.job.build(fullJobName, args)
      robot.log(`${botName} - Started job in Jenkins`, prInfo, buildId)
    }
  } catch (error) {
    pendingPullRequests.set(prInfo.number, { context: context, prInfo: prInfo, fullJobName: fullJobName })
    robot.log.error(`${botName} - Error while triggering Jenkins build. Will retry later, current queue length is ${pendingPullRequests.size}`, prInfo, error)
  }
}

async function checkPendingPullRequests (robot) {
  const _pendingPullRequests = pendingPullRequests.clone()

  robot.log.debug(`${botName} - Processing ${_pendingPullRequests.size} pending PRs`)

  for (const { context, prInfo, fullJobName } of _pendingPullRequests.values()) {
    await processPullRequest(context, robot, prInfo, fullJobName)
  }

  robot.log.debug(`${botName} - Finished processing ${_pendingPullRequests.size} pending PRs`)
}
