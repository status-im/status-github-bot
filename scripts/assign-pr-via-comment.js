// Description:
//   Script that listens to comments on GitHub pull requests
//   and requests a review from the mentioned users
//
// Dependencies:
//   github: "^13.1.0"
//
// Author:
//   Martin Klepsch

const defaultConfig = require('../lib/config')

module.exports = (robot) => {
  // Comments on PRs are treated as issue comments, the payload
  // contains a "pull_request" field which can be used to
  // differentiate from other issue_comment events
  // TODO might be worth supporting edits as well
  robot.on('issue_comment.created', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return }
    robot.log.info('Starting AssignPRViaComment bot')

    // A new PR was opened
    await assignPullRequestViaComment(context, robot)
  })
}

async function assignPullRequestViaComment (context, robot) {
  const payload = context.payload
  const github = context.github
  const config = defaultConfig(robot, '.github/github-bot.yml')
  const ownerName = payload.repository.owner.login
  const repoName = payload.repository.name
  const prNumber = payload.issue.number

  if (undefined === payload.issue.pull_request) {
    robot.log.debug('Not a Pull request comment')
    return
  }

  if (!payload.comment.body.startsWith('/review')) {
    robot.log.debug('Pull request comment does not start with /review')
    return
  }

  // TODO probably this should be enhanced so that not all mentions in a comment
  // are requested as reviewers. Maybe only inspect the line that starts with /review.
  const pattern = /\B@([a-z0-9]+)/ig
  const mentions = payload.comment.body.match(pattern).map(m => m.substr(1))
  robot.log.info(`Reviewers ${mentions} extracted from body ${payload.comment.body}`)

  robot.log(`assignPullRequestToReviewViaComment - Handling Pull Request Comment #${prNumber} on repo ${ownerName}/${repoName}`)

  var allUsersKnown = true
  mentions.forEach(m => {
    if (!config['github']['slack-mapping'][m]) {
      allUsersKnown = false
    }
  })

  if (allUsersKnown) {
    try {
      if (process.env.DRY_RUN) {
        robot.log.info('Would have assigned reviewers to', prNumber, [])
      } else {
        // Create a review request for the mentioned users
        let reviewReq = await github.pullRequests.createReviewRequest({
          owner: ownerName,
          repo: repoName,
          number: prNumber,
          reviewers: mentions,
          team_reviewers: []
        })
        robot.log.debug('Created ReviewRequest', reviewReq)
      }
    } catch (err) {
      robot.log.error(`Couldn't create ReviewRequest for the PR: ${err}`)
    }
  } else {
    robot.log.error('Unknown user mentioned in review request comment', mentions)
  }
}
