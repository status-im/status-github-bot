// Description:
//   Script that listens to GitHub pull reviews
//   and assigns the PR to TO TEST column on the 'Pipeline for QA' project
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//   probot-scheduler: "^1.0.3"
//   probot-slack-status: "^0.2.2"
//
// Author:
//   PombeirP

// const getConfig = require('probot-config')
const defaultConfig = require('../lib/config')
const createScheduler = require('probot-scheduler')
const Slack = require('probot-slack-status')
const slackHelper = require('../lib/slack')

let slackClient = null

module.exports = robot => {
  // robot.on('slack.connected', ({ slack }) => {
  Slack(robot, (slack) => {
    robot.log.trace('Connected, assigned slackClient')
    slackClient = slack
  })

  createScheduler(robot, { interval: 10 * 60 * 1000 })
  robot.on('schedule.repository', context => checkOpenPullRequests(robot, context))
}

async function getReviewApprovalState (github, robot, repo, pullRequest) {
  const threshold = 2 // Minimum number of approvers

  var finalReviews = await getPullRequestReviewStates(github, repo, pullRequest)
  robot.log.debug(finalReviews)

  const approvedReviews = finalReviews.filter(reviewState => reviewState === 'APPROVED')
  if (approvedReviews.length >= threshold) {
    const reviewsWithChangesRequested = finalReviews.filter(reviewState => reviewState === 'CHANGES_REQUESTED')
    if (reviewsWithChangesRequested.length === 0) {
      // Get detailed pull request
      const fullPullRequestPayload = await github.pullRequests.get({owner: repo.owner.login, repo: repo.name, number: pullRequest.number})
      pullRequest = fullPullRequestPayload.data
      if (pullRequest.mergeable !== null && pullRequest.mergeable !== undefined && !pullRequest.mergeable) {
        robot.log.debug(`pullRequest.mergeable is ${pullRequest.mergeable}, considering as failed`)
        return 'failed'
      }

      let state = 'pending'
      switch (pullRequest.mergeable_state) {
        case 'clean':
          state = 'approved'
          break
        case 'dirty':
          state = 'failed'
          break
      }
      robot.log.debug(`pullRequest.mergeable_state is ${pullRequest.mergeable_state}, considering state as ${state}`)

      return state
    }
  }

  return 'pending'
}

async function getPullRequestReviewStates (github, repo, pullRequest) {
  var finalReviewsMap = new Map()
  const ghreviews = await github.paginate(
    github.pullRequests.getReviews({owner: repo.owner.login, repo: repo.name, number: pullRequest.number, per_page: 100}),
    res => res.data)
  for (var review of ghreviews) {
    switch (review.state) {
      case 'APPROVED':
      case 'CHANGES_REQUESTED':
      case 'PENDING':
        finalReviewsMap.set(review.user.id, review.state)
        break
    }
  }

  return Array.from(finalReviewsMap.values())
}

async function getProjectFromName (github, ownerName, repoName, projectBoardName) {
  const ghprojectsPayload = await github.projects.getRepoProjects({
    owner: ownerName,
    repo: repoName,
    state: 'open'
  })

  return ghprojectsPayload.data.find(p => p.name === projectBoardName)
}

async function getProjectCardForPullRequest (github, columnId, pullRequestUrl) {
  const ghcardsPayload = await github.projects.getProjectCards({column_id: columnId})
  const ghcard = ghcardsPayload.data.find(c => c.content_url === pullRequestUrl)

  return ghcard
}

async function checkOpenPullRequests (robot, context) {
  const github = context.github
  const repo = context.payload.repository
  const ownerName = repo.owner.login
  const repoName = repo.name

  // const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const config = defaultConfig(robot, '.github/github-bot.yml')
  const projectBoardConfig = config['project-board']

  if (!projectBoardConfig) {
    return
  }

  const contributorColumnName = projectBoardConfig['contributor-column-name']
  const reviewColumnName = projectBoardConfig['review-column-name']
  const testColumnName = projectBoardConfig['test-column-name']

  // Fetch repo projects
  // TODO: The repo project and project column info should be cached
  // in order to improve performance and reduce roundtrips
  let project
  try {
    // Find 'Pipeline for QA' project
    project = await getProjectFromName(github, ownerName, repoName, projectBoardConfig.name)
    if (!project) {
      robot.log.error(`Couldn't find project ${projectBoardConfig.name} in repo ${ownerName}/${repoName}`)
      return
    }

    robot.log.debug(`Fetched ${project.name} project (${project.id})`)
  } catch (err) {
    robot.log.error(`Couldn't fetch the github projects for repo: ${err}`, ownerName, repoName)
    return
  }

  // Fetch column IDs
  let ghcolumns
  try {
    const ghcolumnsPayload = await github.projects.getProjectColumns({ project_id: project.id })
    ghcolumns = ghcolumnsPayload.data
  } catch (err) {
    robot.log.error(`Couldn't fetch the github columns for project: ${err}`, ownerName, repoName, project.id)
    return
  }

  const contributorColumn = ghcolumns.find(c => c.name === contributorColumnName)
  if (!contributorColumn) {
    robot.log.error(`Couldn't find ${contributorColumnName} column in project ${project.name}`)
    return
  }

  const reviewColumn = ghcolumns.find(c => c.name === reviewColumnName)
  if (!reviewColumn) {
    robot.log.error(`Couldn't find ${reviewColumnName} column in project ${project.name}`)
    return
  }

  const testColumn = ghcolumns.find(c => c.name === testColumnName)
  if (!testColumn) {
    robot.log.error(`Couldn't find ${testColumnName} column in project ${project.name}`)
    return
  }

  robot.log.debug(`Fetched ${contributorColumn.name} (${contributorColumn.id}), ${reviewColumn.name} (${reviewColumn.id}), ${testColumn.name} (${testColumn.id}) columns`)

  try {
    // Gather all open PRs in this repo
    const allPullRequests = await github.paginate(
      github.pullRequests.getAll({owner: ownerName, repo: repoName, per_page: 100}),
      res => res.data
    )

    // And make sure they are assigned to the correct project column
    for (var pullRequest of allPullRequests) {
      try {
        await assignPullRequestToCorrectColumn(github, robot, repo, pullRequest, contributorColumn, reviewColumn, testColumn, config.slack.notification.room)
      } catch (err) {
        robot.log.error(`Unhandled exception while processing PR: ${err}`, ownerName, repoName)
      }
    }
  } catch (err) {
    robot.log.error(`Couldn't fetch the github pull requests for repo: ${err}`, ownerName, repoName)
  }
}

async function assignPullRequestToCorrectColumn (github, robot, repo, pullRequest, contributorColumn, reviewColumn, testColumn, room) {
  const ownerName = repo.owner.login
  const repoName = repo.name
  const prNumber = pullRequest.number

  let state = null
  try {
    state = await getReviewApprovalState(github, robot, repo, pullRequest)
  } catch (err) {
    robot.log.error(`Couldn't calculate the PR approval state: ${err}`, ownerName, repoName, prNumber)
  }

  let srcColumns, dstColumn
  switch (state) {
    case 'approved':
      srcColumns = [contributorColumn, reviewColumn]
      dstColumn = testColumn
      break
    case 'failed':
      srcColumns = [reviewColumn, testColumn]
      dstColumn = reviewColumn
      break
    case 'pending':
      srcColumns = [testColumn]
      dstColumn = contributorColumn
      break
    default:
      return
  }

  robot.log.debug(`assignPullRequestToTest - Handling Pull Request #${prNumber} on repo ${ownerName}/${repoName}. PR should be in ${dstColumn.name} column`)

  // Look for PR card in source column(s)
  let existingGHCard = null
  let srcColumn = null
  for (const c of srcColumns) {
    try {
      existingGHCard = await getProjectCardForPullRequest(github, c.id, pullRequest.issue_url)
      if (existingGHCard) {
        srcColumn = c
        break
      }
    } catch (err) {
      robot.log.error(`Failed to retrieve project card for the PR, aborting: ${err}`, c.id, pullRequest.issue_url)
      return
    }
  }

  if (existingGHCard) {
    // Move PR card to the destination column
    try {
      robot.log.trace(`Found card in source column ${srcColumn.name}`, existingGHCard.id, srcColumn.id)

      if (process.env.DRY_RUN || process.env.DRY_RUN_PR_TO_TEST) {
        robot.log.info(`Would have moved card ${existingGHCard.id} to ${dstColumn.name} for PR #${prNumber}`)
      } else {
        // Found in the source column, let's move it to the destination column
        await github.projects.moveProjectCard({id: existingGHCard.id, position: 'bottom', column_id: dstColumn.id})
      }

      robot.log.info(`Moved card ${existingGHCard.id} to ${dstColumn.name} for PR #${prNumber}`)

      slackHelper.sendMessage(robot, slackClient, room, `Assigned PR to ${dstColumn.name} column\n${pullRequest.html_url}`)
    } catch (err) {
      robot.log.error(`Couldn't move project card for the PR: ${err}`, srcColumn.id, dstColumn.id, pullRequest.id)
      slackHelper.sendMessage(robot, slackClient, room, `I couldn't move the PR to ${dstColumn.name} column :confused:\n${pullRequest.html_url}`)
    }
  } else {
    try {
      robot.log.debug(`Didn't find card in source column(s)`, srcColumns.map(c => c.id))

      // Look for PR card in destination column
      try {
        const existingGHCard = await getProjectCardForPullRequest(github, dstColumn.id, pullRequest.issue_url)
        if (existingGHCard) {
          robot.log.trace(`Found card in target column, ignoring`, existingGHCard.id, dstColumn.id)
          return
        }
      } catch (err) {
        robot.log.error(`Failed to retrieve project card for the PR, aborting: ${err}`, dstColumn.id, pullRequest.issue_url)
        return
      }

      if (process.env.DRY_RUN || process.env.DRY_RUN_PR_TO_TEST) {
        robot.log.info(`Would have created card in ${dstColumn.name} column for PR #${prNumber}`)
      } else {
        // It wasn't in either the source nor the destination columns, let's create a new card for it in the destination column
        const ghcardPayload = await github.projects.createProjectCard({
          column_id: dstColumn.id,
          content_type: 'PullRequest',
          content_id: pullRequest.id
        })

        robot.log.info(`Created card ${ghcardPayload.data.id} in ${dstColumn.name} for PR #${prNumber}`)
      }
    } catch (err) {
      // We normally arrive here because there is already a card for the PR in another column
      robot.log.debug(`Couldn't create project card for the PR: ${err}`, dstColumn.id, pullRequest.id)
    }
  }
}
