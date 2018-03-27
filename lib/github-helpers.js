// Description:
//   GtHub-related helpers
//
// Dependencies:
//   github: "^13.1.0"
//
// Author:
//   PombeirP

module.exports = {
  getPullRequestReviewStates: _getPullRequestReviewStates,
  getReviewApprovalState: _getReviewApprovalState,
  getProjectCardForIssue: _getProjectCardForIssue,
  getOrgProjectByName: _getOrgProjectByName,
  getRepoProjectByName: _getRepoProjectByName,
  getProjectColumnByName: _getProjectColumnByName
}

async function _getPullRequestReviewStates (github, prInfo) {
  let finalReviewsMap = new Map()
  const ghreviews = await github.paginate(
    github.pullRequests.getReviews({ ...prInfo, per_page: 100 }),
    res => res.data)
  for (const review of ghreviews) {
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

async function _getReviewApprovalState (github, robot, prInfo, testedPullRequestLabelName) {
  // Get detailed pull request
  const pullRequestPayload = await github.pullRequests.get(prInfo)
  const pullRequest = pullRequestPayload.data
  if (pullRequest.mergeable !== null && pullRequest.mergeable !== undefined && !pullRequest.mergeable) {
    robot.log.debug(`pullRequest.mergeable is ${pullRequest.mergeable}, considering as failed`)
    return 'failed'
  }

  let state
  switch (pullRequest.mergeable_state) {
    case 'clean':
      if (testedPullRequestLabelName !== null && pullRequest.labels.find(label => label.name === testedPullRequestLabelName)) {
        robot.log.debug(`Pull request is labeled '${testedPullRequestLabelName}', ignoring`)
        return null
      }

      state = 'approved'
      break
    case 'dirty':
      state = 'failed'
      break
  }
  robot.log.debug(`pullRequest.mergeable_state is ${pullRequest.mergeable_state}, considering state as ${state}`)

  if (state !== 'approved') {
    return state
  }

  const threshold = 2 // Minimum number of approvers

  const finalReviews = await _getPullRequestReviewStates(github, prInfo)
  robot.log.debug(finalReviews)

  const approvedReviews = finalReviews.filter(reviewState => reviewState === 'APPROVED')
  if (approvedReviews.length >= threshold) {
    const reviewsWithChangesRequested = finalReviews.filter(reviewState => reviewState === 'CHANGES_REQUESTED')
    if (reviewsWithChangesRequested.length === 0) {
      return 'approved'
    }

    return 'changes_requested'
  }

  return 'awaiting_reviewers'
}

async function _getProjectCardForIssue (github, columnId, issueUrl) {
  const ghcardsPayload = await github.projects.getProjectCards({column_id: columnId})
  const ghcard = ghcardsPayload.data.find(c => c.content_url === issueUrl)

  return ghcard
}

async function _getOrgProjectByName (github, robot, orgName, projectName, botName) {
  if (!projectName) {
    return null
  }

  try {
    // Fetch org projects
    // TODO: The org project and project column info should be cached
    // in order to improve performance and reduce roundtrips
    const ghprojectsPayload = await github.projects.getOrgProjects({
      org: orgName,
      state: 'open'
    })

    const project = ghprojectsPayload.data.find(p => p.name === projectName)
    if (!project) {
      robot.log.error(`${botName} - Couldn't find project ${projectName} in ${orgName} org`)
      return null
    }

    robot.log.debug(`${botName} - Fetched ${project.name} project (${project.id})`)

    return project
  } catch (err) {
    robot.log.error(`${botName} - Couldn't fetch the github projects for org`, orgName, err)
    return null
  }
}

async function _getRepoProjectByName (github, robot, repoInfo, projectName, botName) {
  if (!projectName) {
    return null
  }

  try {
    const ghprojectsPayload = await github.projects.getRepoProjects({ ...repoInfo, state: 'open' })
    const project = ghprojectsPayload.data.find(p => p.name === projectName)
    if (!project) {
      robot.log.error(`${botName} - Couldn't find project ${projectName} in repo ${repoInfo.owner}/${repoInfo.repo}`)
      return null
    }

    robot.log.debug(`${botName} - Fetched ${project.name} project (${project.id})`)

    return project
  } catch (err) {
    robot.log.error(`${botName} - Couldn't fetch the github projects for repo: ${err}`, repoInfo)
    return null
  }
}

async function _getProjectColumnByName (github, robot, project, columnName, botName) {
  if (!project) {
    return null
  }
  if (!columnName) {
    return null
  }

  try {
    const ghcolumnsPayload = await github.projects.getProjectColumns({ project_id: project.id })
    const column = ghcolumnsPayload.data.find(c => c.name === columnName)
    if (!column) {
      robot.log.error(`${botName} - Couldn't find ${columnName} column in project ${project.name}`)
      return null
    }

    robot.log.debug(`${botName} - Fetched ${column.name} column (${column.id})`)

    return column
  } catch (err) {
    robot.log.error(`${botName} - Couldn't fetch the github columns for project: ${err}`, project.id)
    return null
  }
}
