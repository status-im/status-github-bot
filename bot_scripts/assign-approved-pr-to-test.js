// Description:
//   Script that periodically checks to GitHub pull request reviews
//   and assigns the PR to CONTRIBUTOR/REVIEW/TO TEST columns on the 'Pipeline for QA' project
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//   probot-scheduler: "^1.0.3"
//
// Author:
//   PombeirP

const createScheduler = require('probot-scheduler')
const getConfig = require('probot-config')

const defaultConfig = require('../lib/config')
const gitHubHelpers = require('../lib/github-helpers')
// const slackHelper = require('../lib/slack')

const botName = 'assign-approved-pr-to-test'

module.exports = robot => {
  createScheduler(robot, { interval: 10 * 60 * 1000, delay: !process.env.DISABLE_DELAY })
  robot.on('schedule.repository', context => checkOpenPullRequests(robot, context))
  robot.on('pull_request.opened', context => handleOpenedPullRequest(robot, context))
}

// This method creates a sentinel status in new PRs so that they can't be merged before an e2e test run has successfully completed
async function handleOpenedPullRequest (robot, context) {
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const projectBoardConfig = config ? config['project-board'] : null
  const automatedTestsConfig = config ? config['automated-tests'] : null
  if (!projectBoardConfig || !automatedTestsConfig) {
    return
  }

  await context.github.repos.createStatus(context.repo({
    context: 'Mobile e2e tests',
    description: 'Tests will run once the PR is moved to the TO TEST column',
    sha: context.payload.pull_request.head.sha,
    state: 'error'
  }))
}

async function checkOpenPullRequests (robot, context) {
  const { github, payload: { repository: repo } } = context
  const repoInfo = context.repo()
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const projectBoardConfig = config ? config['project-board'] : null

  if (!projectBoardConfig) {
    robot.log.debug(`${botName} - Project board not configured in repo ${repoInfo.owner}/${repoInfo.repo}, ignoring`)
    return
  }

  const testedPullRequestLabelName = projectBoardConfig['tested-pr-label-name']
  const contributorColumnName = projectBoardConfig['contributor-column-name']
  const reviewColumnName = projectBoardConfig['review-column-name']
  const testColumnName = projectBoardConfig['test-column-name']

  // Find 'Pipeline for QA' project
  const project = await gitHubHelpers.getRepoProjectByName(github, robot, repoInfo, projectBoardConfig.name, botName)
  if (!project) {
    return
  }

  // Fetch column IDs
  let ghcolumns
  try {
    const ghcolumnsPayload = await github.projects.listColumns({ project_id: project.id })
    ghcolumns = ghcolumnsPayload.data
  } catch (err) {
    robot.log.error(`${botName} - Couldn't fetch the github columns for project: ${err}`, repoInfo, project.id)
    return
  }

  try {
    const contributorColumn = findColumnByName(ghcolumns, contributorColumnName)
    const reviewColumn = findColumnByName(ghcolumns, reviewColumnName)
    const testColumn = findColumnByName(ghcolumns, testColumnName)
    const columns = { contributor: contributorColumn, review: reviewColumn, test: testColumn }

    robot.log.debug(`${botName} - Fetched ${contributorColumn.name} (${contributorColumn.id}), ${reviewColumn.name} (${reviewColumn.id}), ${testColumn.name} (${testColumn.id}) columns`)

    try {
      // Gather all open PRs in this repo
      const allPullRequests = await github.paginate(
        github.pullRequests.list(context.repo({ per_page: 100 })),
        res => res.data
      )

      // And make sure they are assigned to the correct project column
      for (const pullRequest of allPullRequests) {
        try {
          await assignPullRequestToCorrectColumn(context, robot, repo, pullRequest, testedPullRequestLabelName, columns, config.slack.notification.room)
        } catch (err) {
          robot.log.error(`${botName} - Unhandled exception while processing PR: ${err}`, repoInfo)
        }
      }
    } catch (err) {
      robot.log.error(`${botName} - Couldn't fetch the github pull requests for repo: ${err}`, repoInfo)
    }
  } catch (err) {
    robot.log.error(err.message, project.name)
  }
}

async function assignPullRequestToCorrectColumn (context, robot, repo, pullRequest, testedPullRequestLabelName, columns, room) {
  const { github } = context
  const prInfo = { owner: repo.owner.login, repo: repo.name, number: pullRequest.number }

  let state = null
  try {
    // Ignore statuses created by us
    const filterFn = (status) => !(status.context === 'Mobile e2e tests' &&
                                   status.creator &&
                                   (status.creator.login === 'status-github-bot[bot]' || status.creator.login === 'e2e-tests-check-bot[bot]'))

    state = await gitHubHelpers.getReviewApprovalState(context, robot, prInfo, testedPullRequestLabelName, filterFn)
  } catch (err) {
    robot.log.error(`${botName} - Couldn't calculate the PR approval state: ${err}`, prInfo)
  }

  const { srcColumns, dstColumn } = getColumns(state, columns)
  if (!dstColumn) {
    robot.log.debug(`${botName} - No dstColumn, state=${state}, columns=${JSON.stringify(columns)}, srcColumns=${srcColumns}`)
    return
  }

  robot.log.debug(`${botName} - Handling Pull Request #${prInfo.number} on repo ${prInfo.owner}/${prInfo.repo}. PR should be in ${dstColumn.name} column`)

  // Look for PR card in source column(s)
  let existingGHCard = null
  let srcColumn = null
  for (const c of srcColumns) {
    try {
      existingGHCard = await gitHubHelpers.getProjectCardForIssue(github, c.id, pullRequest.issue_url)
      if (existingGHCard) {
        srcColumn = c
        break
      }
    } catch (err) {
      robot.log.error(`${botName} - Failed to retrieve project card for the PR, aborting: ${err}`, c.id, pullRequest.issue_url)
      return
    }
  }

  if (existingGHCard) {
    // Move PR card to the destination column
    try {
      robot.log.trace(`${botName} - Found card in source column ${srcColumn.name}`, existingGHCard.id, srcColumn.id)

      if (dstColumn === srcColumn) {
        return
      }

      if (process.env.DRY_RUN || process.env.DRY_RUN_PR_TO_TEST) {
        robot.log.info(`${botName} - Would have moved card ${existingGHCard.id} to ${dstColumn.name} for PR #${prInfo.number}`)
      } else {
        // Found in the source column, let's move it to the destination column
        await github.projects.moveProjectCard({id: existingGHCard.id, position: 'bottom', column_id: dstColumn.id})

        robot.log.info(`${botName} - Moved card ${existingGHCard.id} to ${dstColumn.name} for PR #${prInfo.number}`)
      }

      // slackHelper.sendMessage(robot, room, `Assigned PR to ${dstColumn.name} column\n${pullRequest.html_url}`)
    } catch (err) {
      robot.log.error(`${botName} - Couldn't move project card for the PR: ${err}`, srcColumn.id, dstColumn.id, pullRequest.id)
      // slackHelper.sendMessage(robot, room, `I couldn't move the PR to ${dstColumn.name} column :confused:\n${pullRequest.html_url}`)
    }
  } else {
    try {
      robot.log.debug(`${botName} - Didn't find card in source column(s)`, srcColumns.map(c => c.id))

      // Look for PR card in destination column
      try {
        const existingGHCard = await gitHubHelpers.getProjectCardForIssue(github, dstColumn.id, pullRequest.issue_url)
        if (existingGHCard) {
          robot.log.trace(`${botName} - Found card in target column, ignoring`, existingGHCard.id, dstColumn.id)
          return
        }
      } catch (err) {
        robot.log.error(`${botName} - Failed to retrieve project card for the PR, aborting: ${err}`, dstColumn.id, pullRequest.issue_url)
        return
      }

      if (process.env.DRY_RUN || process.env.DRY_RUN_PR_TO_TEST) {
        robot.log.info(`Would have created card in ${dstColumn.name} column for PR #${prInfo.number}`)
      } else {
        // It wasn't in either the source nor the destination columns, let's create a new card for it in the destination column
        const ghcardPayload = await github.projects.createProjectCard({
          column_id: dstColumn.id,
          content_type: 'PullRequest',
          content_id: pullRequest.id
        })

        robot.log.info(`${botName} - Created card ${ghcardPayload.data.id} in ${dstColumn.name} for PR #${prInfo.number}`)
      }
    } catch (err) {
      // We normally arrive here because there is already a card for the PR in another column
      robot.log.debug(`${botName} - Couldn't create project card for the PR: ${err}`, dstColumn.id, pullRequest.id)
    }
  }
}

function getColumns (state, columns) {
  switch (state) {
    case 'awaiting_reviewers':
      return { srcColumns: [columns.contributor, columns.test], dstColumn: columns.review }
    case 'changes_requested':
      return { srcColumns: [columns.review, columns.test], dstColumn: columns.contributor }
    case 'failed':
      return { srcColumns: [columns.review, columns.test], dstColumn: columns.contributor }
    case 'approved':
      return { srcColumns: [columns.contributor, columns.review], dstColumn: columns.test }
    default:
      return { srcColumns: [], dstColumn: null }
  }
}

function findColumnByName (ghcolumns, columnName) {
  const column = ghcolumns.find(c => c.name === columnName)
  if (!column) {
    throw new Error(`${botName} - Couldn't find ${columnName} column`)
  }

  return column
}
