// Description:
//   GtHub-related helpers
//
// Dependencies:
//   github: "^13.1.0"
//
// Author:
//   PombeirP

module.exports.getPullRequestReviewStates = _getPullRequestReviewStates
module.exports.getReviewApprovalState = _getReviewApprovalState
module.exports.getProjectCardForIssue = _getProjectCardForIssue

async function _getPullRequestReviewStates (github, repoOwner, repoName, prNumber) {
  let finalReviewsMap = new Map()
  const ghreviews = await github.paginate(
    github.pullRequests.getReviews({owner: repoOwner, repo: repoName, number: prNumber, per_page: 100}),
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

async function _getReviewApprovalState (github, robot, repoOwner, repoName, prNumber) {
  // Get detailed pull request
  const pullRequestPayload = await github.pullRequests.get({owner: repoOwner, repo: repoName, number: prNumber})
  const pullRequest = pullRequestPayload.data
  if (pullRequest.mergeable !== null && pullRequest.mergeable !== undefined && !pullRequest.mergeable) {
    robot.log.debug(`pullRequest.mergeable is ${pullRequest.mergeable}, considering as failed`)
    return 'failed'
  }

  let state
  switch (pullRequest.mergeable_state) {
    case 'clean':
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

  const finalReviews = await _getPullRequestReviewStates(github, repoOwner, repoName, pullRequest.number)
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
