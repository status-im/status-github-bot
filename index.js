const MemCache = require('mem-cache')
const SlackGitHubCacheBuilder = require('./lib/retrieve-slack-github-users')

module.exports = async (robot) => {
  console.log('Yay, the app was loaded!')

  const slackGitHubCache = new MemCache({ timeoutDisabled: true })
  const slackCachePromise = SlackGitHubCacheBuilder.build(robot, slackGitHubCache)

  require('./bot_scripts/assign-new-pr-to-review')(robot)
  require('./bot_scripts/assign-approved-pr-to-test')(robot)
  require('./scripts/assign-pr-via-comment')(robot)
  require('./bot_scripts/assign-to-bounty-awaiting-for-approval')(robot)
  require('./bot_scripts/greet-new-contributor')(robot)

  await slackCachePromise
  robot.log.info('Slack user ID cache populated, loading remainder of scripts')

  // Add scripts which require using the Slack/GitHub cache after this comment

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
}
