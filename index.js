// Description:
//   Startup script
//
// Dependencies:
//   mem-cache: "0.0.5"
//   memjs: "^1.2.0"
//   @slack/client: "^3.16.0"
//
// Author:
//   PombeirP

// const Slack = require('./lib/slack')
const memjs = require('memjs')

module.exports = async (robot) => {
  console.log('Yay, the app was loaded!')
  if (process.env.DEBUG) {
    // HACK: If we're attached to the debugger, send output to console
    robot.log.error = console.log
    robot.log.warn = console.log
    robot.log.info = console.log
    robot.log.debug = console.log
    robot.log.trace = console.log
  }

  setupMemcache(robot)
  // await setupSlack(robot)

  // robot['slackProfileCache'] = require('./lib/slack-profile-cache')(robot)

  require('./bot_scripts/assign-new-pr-to-review')(robot)
  require('./bot_scripts/assign-approved-pr-to-test')(robot)
  require('./bot_scripts/assign-to-bounty-awaiting-for-approval')(robot)
  require('./bot_scripts/assign-to-bounty-bug-column')(robot)
  require('./bot_scripts/greet-new-contributor')(robot)
  require('./bot_scripts/trigger-automation-test-build')(robot)
  // require('./bot_scripts/bounty-awaiting-approval-slack-ping')(robot)
  // require('./bot_scripts/notify-reviewers-via-slack')(robot)
  // require('./bot_scripts/tip-kudos-recipients')(robot)
  // require('./bot_scripts/check-bot-balance')(robot)
  require('./bot_scripts/manage-pr-checklist')(robot)

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
}

// async function setupSlack (robot) {
//   Slack.setup(robot, slack => {})

//   await new Promise(resolve => {
//     robot.on('slack.connected', event => {
//       robot.log.info(`Connected to Slack`)

//       // Copy Slack RTM and Slack Web clients to the robot object
//       robot['slack'] = event.payload.slack
//       robot['slackWeb'] = event.payload.slackWeb

//       resolve()
//     })
//   })
// }

function setupMemcache (robot) {
  // Environment variables are defined in .env
  let MEMCACHE_URL = process.env.MEMCACHE_URL || '127.0.0.1:11211'
  if (process.env.USE_GAE_MEMCACHE) {
    MEMCACHE_URL = `${process.env.GAE_MEMCACHE_HOST}:${process.env.GAE_MEMCACHE_PORT}`
  }
  const mc = memjs.Client.create(MEMCACHE_URL, {
    username: process.env.MEMCACHE_USERNAME,
    password: process.env.MEMCACHE_PASSWORD
  })

  // Copy memcache client to the robot object
  robot['memcache'] = mc
}
