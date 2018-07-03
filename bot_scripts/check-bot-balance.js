// Description:
//   Script that monitors the balance of the wallet used by
//      the bot to do payouts and sends a Slack DM if it falls
//      under a threshold
//
// Dependencies:
//
// Author:
//   iSasFTW

const slackHelper = require('../lib/slack')

const ethers = require('ethers')

const options = getOptions(process.env.CHECK_BOT_BALANCE_CONFIG)
const botName = 'check-bot-balance'
const checkIntervalInSecs = parseInt(options.options.check_interval_in_secs)
const minWarningAgeInMillisecs = 24 * 60 * 60 * 1000

var isCheckingBalance = false

module.exports = robot => {
  if (!options || !options.accounts || options.accounts.length === 0) {
    robot.log.debug(`${botName} - No accounts configured. Disabling script`)
    return
  }

  robot.log.info(`${botName} - Repeating script every ${checkIntervalInSecs} seconds`)
  if (process.env.DISABLE_DELAY) {
    setTimeout(() => checkBotBalance(robot), 1 * 1000)
  }
  setInterval(() => checkBotBalance(robot), checkIntervalInSecs * 1000)
}

function getOptions (optionsString) {
  return JSON.parse(optionsString.split(`'`).join(`"`))
}

async function checkBotBalance (robot) {
  if (isCheckingBalance) {
    return
  }

  isCheckingBalance = true
  try {
    for (const account of options.accounts) {
      try {
        const lastWarningTimestamp = account.lastWarningTimestamp || 0
        const warningThresholdTimestamp = lastWarningTimestamp + minWarningAgeInMillisecs
        const now = (new Date()).getTime()

        // Make sure we don't flood Slack with repeated notifications
        if (now > warningThresholdTimestamp) {
          const provider = ethers.providers.getDefaultProvider(account.network_id)
          const balance = await provider.getBalance(account.address)
          const minBalance = ethers.utils.parseUnits(account.min_balance.toString(), 'ether')

          // Format balance to ether, check if is under threshold
          if (balance.lt(minBalance)) {
            // Send slack message
            const slackChannelID = options.slack.notification.channel_id
            const msg = `<!here> URGENT: ${account.name} account ETH will run out soon, current balance is ${ethers.utils.formatEther(balance)} ETH (threshold: ${ethers.utils.formatEther(minBalance)} ETH)\nhttps://etherscan.io/address/${account.address}`

            robot.log.info(`Notifying Slack channel with ID ${slackChannelID} about bot balance`)

            robot.slackWeb.chat.postMessage(slackChannelID, msg, {unfurl_links: false, as_user: slackHelper.BotUserName})

            account.lastWarningTimestamp = now
          }
        }
      } catch (error) {
        robot.log.error(`${botName} - Error while checking ${account.name} account balance: ${error}`)
      }
    }
  } finally {
    isCheckingBalance = false
  }
}
