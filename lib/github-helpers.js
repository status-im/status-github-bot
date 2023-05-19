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
  getProjectColumnByName: _getProjectColumnByName,
  getPullRequestCurrentStatusForContext: _getPullRequestCurrentStatusForContext
}

async function _getPullRequestReviewStates (github, prInfo) {
  let finalReviewsMap = new Map()
  const ghreviews = await github.paginate(
    github.pullRequests.listReviews({ ...prInfo, per_page: 100 }),
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

async function _getReviewApprovalState (context, robot, prInfo, minReviewers, testedPullRequestLabelName, filterIgnoredStatusContextFn) {
  const { github } = context

  // Get detailed pull request
  const prPayload = await github.pullRequests.get(prInfo)
  const pr = prPayload.data
  context.payload.pull_request = pr
  if (pr.mergeable === false && pr.mergeable_state != 'dirty') {
    robot.log.debug(`PR #${prInfo.number} - pr.mergeable is ${pr.mergeable} and not dirty, considering as failed`)
    return 'failed'
  }

  let state
  switch (pr.mergeable_state) {
    case 'clean':
      if (testedPullRequestLabelName !== null && pr.labels.find(label => label.name === testedPullRequestLabelName)) {
        robot.log.debug(`PR #${prInfo.number} - request is labeled '${testedPullRequestLabelName}', ignoring`)
        return null
      }
      state = 'approved'
      break
    case 'dirty':
      /* Currently ignored. */
      robot.log.debug(`PR #${prInfo.number} - pr.mergeable_state=${pr.mergeable_state}, pr.mergeable=${pr.mergeable}`)
      break
    case 'unstable':
      if (filterIgnoredStatusContextFn) {
        const isSuccess = await _isPullRequestStatusSuccessIgnoringContext(context, filterIgnoredStatusContextFn, pr)
        if (isSuccess) {
          state = 'approved'
          robot.log.debug(`All important statuses are successful, so considering state as ${state}`)
        }
      }
      break
  }
  robot.log.debug(`PR #${prInfo.number} - mergeable_state is ${pr.mergeable_state}, considering state as ${state}`)

  if (state !== 'approved') {
    return state
  }

  const threshold = minReviewers // Minimum number of approvers

  const finalReviews = await _getPullRequestReviewStates(github, prInfo)
  robot.log.debug(finalReviews)

  const approvedReviews = finalReviews.filter(reviewState => reviewState === 'APPROVED')
  if (approvedReviews.length >= threshold) {
    const reviewsWithChangesRequested = finalReviews.filter(reviewState => reviewState === 'CHANGES_REQUESTED')
    if (reviewsWithChangesRequested.length === 0) {
      robot.log.debug(`No changes requested, considering state as approved`)
      return 'approved'
    }

    robot.log.debug(`${reviewsWithChangesRequested.length} changes requested, considering state as changes_requested`)
    return 'changes_requested'
  }

  robot.log.debug(`Not enough reviewers yet, considering state as awaiting_reviewers`)
  return 'awaiting_reviewers'
}

async function _getProjectCardForIssue (github, columnId, issueUrl) {
  const ghcardsPayload = await github.projects.listCards({ column_id: columnId })
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
      robot.log.warning(`${botName} - Couldn't find project ${projectName} in ${orgName} org`)
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
    const ghprojectsPayload = await github.projects.listForRepo({ ...repoInfo, state: 'open' })
    const project = ghprojectsPayload.data.find(p => p.name === projectName)
    if (!project) {
      robot.log.warn(`${botName} - Couldn't find project ${projectName} in repo ${repoInfo.owner}/${repoInfo.repo}`)
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
    const ghcolumnsPayload = await github.projects.listColumns({ project_id: project.id })
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

async function _getPullRequestCurrentStatusForContext (context, statusContext, pr) {
  if (!pr) {
    pr = context.payload.pull_request
  }

  const { data: { statuses } } = await context.github.repos.getCombinedStatusForRef(context.repo({
    ref: pr.head.sha
  }))

  return (statuses.find(status => status.context === statusContext) || {}).state
}

async function _isPullRequestStatusSuccessIgnoringContext (context, filterIgnoredStatusContextFn, pr) {
  if (!pr) {
    pr = context.payload.pull_request
  }

  const statuses = await context.github.paginate(
    context.github.repos.listStatusesForRef(context.repo({
      ref: pr.head.sha,
      per_page: 100
    })),
    res => res.data)

  const contexts = {}
  for (let i = statuses.length - 1; i >= 0; i--) {
    const status = statuses[i]
    if (filterIgnoredStatusContextFn(status)) {
      contexts[status.context] = status.state
    }
  }

  let isSuccess = true
  for (const context in contexts) {
    if (contexts.hasOwnProperty(context)) {
      const state = contexts[context]

      switch (state) {
        case 'pending':
        case 'error':
          isSuccess = false
          break
      }

      if (!isSuccess) {
        break
      }
    }
  }

  return isSuccess
}
