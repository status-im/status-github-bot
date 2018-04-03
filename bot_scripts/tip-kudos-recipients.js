// Description:
//   Script that monitors #kudos Slack channel and sends
//      a tip for each star attributes to target users
//
// Dependencies:
//   axios: "^0.18.0"
//   memjs: "^1.2.0"
//
// Author:
//   PombeirP

const axios = require('axios')
const tokenPayments = require('../lib/token-payments')

const options = getOptions(process.env.KUDOS_BOT_CONFIG)
const botName = 'tip-kudos-recipients'
const kudosChannelId = options.slack.channel_id
const tipPerKudoInUsd = parseFloat(options.rules.tip_per_kudo_in_usd)
const tipPerReactionInUsd = parseFloat(options.rules.tip_per_reaction_in_usd)
const reactionThreshold = parseInt(options.rules.reaction_threshold)
const interTransactionDelay = parseInt(options.options.inter_transaction_delay)

const tokenID = process.env.DEBUG ? 'STT' : 'SNT'
const token = options.payments[tokenID]
const privateKey = token.private_key
const contractAddress = token.contract_address

const kudosBotDataMemcachedKey = 'tip-kudos-recipients-data'
const userIdRegex = /@[A-Z0-9]+/gi
var isCheckingUpdates = false

module.exports = robot => {
  if (!privateKey.startsWith('0x')) {
    robot.log.error(`${botName} - Private key must start with 0x. Disabling script`)
    return
  }

  setTimeout(() => processKudosChannelUpdates(robot), process.env.DISABLE_DELAY ? 1 * 1000 : 30 * 1000)
  setInterval(() => processKudosChannelUpdates(robot), 24 * 60 * 60 * 1000)
}

function getOptions (optionsString) {
  return JSON.parse(optionsString.split(`'`).join(`"`))
}

async function processKudosChannelUpdates (robot) {
  if (isCheckingUpdates) {
    return
  }

  isCheckingUpdates = true
  try {
    const mc = robot['memcache']
    const data = await getSavedData(mc)

    await fetchPendingKudos(robot, data)

    try {
      await processPendingPayments(robot, data, d => setSavedData(mc, d))
    } catch (error) {
      robot.log.warn(`${botName} - Failed to make payment: ${error.responseText}`)
    }
  } catch (error) {
    robot.log.error(`${botName} - Error while processing kudos: ${error}`)
  } finally {
    isCheckingUpdates = false
  }
}

async function getSavedData (mc) {
  const json = await mc.get(kudosBotDataMemcachedKey)
  if (json.value) {
    const data = JSON.parse(json.value)
    if (!data.hasOwnProperty('lastMessageTimestamp') || !data.hasOwnProperty('userPendingPayouts')) {
      throw new Error(`${botName} - Invalid cached data`)
    }
    return data
  }

  return {
    lastMessageTimestamp: (new Date()).getTime() / 1000,
    userPendingPayouts: {}
  }
}

async function setSavedData (mc, data) {
  if (!data.hasOwnProperty('lastMessageTimestamp') || !data.hasOwnProperty('userPendingPayouts')) {
    throw new Error(`${botName} - Invalid data, saving aborted`)
  }

  return mc.set(kudosBotDataMemcachedKey, JSON.stringify(data, {}, 2), {})
}

async function fetchPendingKudos (robot, data) {
  const slackWeb = robot.slackWeb
  const startTime = (new Date()).getTime()
  const thresholdTs = startTime / 1000 - 24 * 60 * 60
  let newMessagesProcessed = 0

  while (true) {
    const historyPayload = await slackWeb.channels.history(kudosChannelId, { oldest: data.lastMessageTimestamp })
    if (historyPayload.ok) {
      if (!historyPayload.has_more && newMessagesProcessed === 0) {
        robot.log.debug(`${botName} - No new entries in ${kudosChannelId} channel history`)
        break
      }

      for (const message of historyPayload.messages.reverse()) {
        const messageTs = parseFloat(message.ts)
        if (messageTs >= thresholdTs) {
          // If the kudos was given less than 24 hours ago, let's ignore it
          // and leave it for a later time, so that people have time to vote
          continue
        }
        if (message.type !== 'message' || message.subtype || !message.bot_id) {
          continue
        }

        ++newMessagesProcessed

        const kudosReceivers = parseKudosReceivers(message.attachments[0].text)
        const kudosTimestamp = new Date(message.ts * 1000).toISOString()
        if (kudosReceivers.length > 0) {
          const reactionCount = countStarReactions(message, kudosReceivers)
          if (reactionCount >= reactionThreshold) {
            const additionalReactionCount = reactionCount - 1
            const totalTip = tipPerKudoInUsd + additionalReactionCount * tipPerReactionInUsd
            const tipPerUser = totalTip / kudosReceivers.length
            const kudosReceiversData = await fetchKudosReceiversData(robot, kudosReceivers, slackWeb)

            robot.log.trace(`${botName} - ${kudosTimestamp}: ${JSON.stringify(kudosReceiversData)} received ${reactionCount} reactions (~${tipPerUser}$ each)`)

            for (const userInfo of kudosReceiversData) {
              let userPendingPayout = data.userPendingPayouts[userInfo.user]
              if (!userPendingPayout) {
                userPendingPayout = { kudosCount: 0, reactionCount: 0, balanceInUsd: 0 }
                data.userPendingPayouts[userInfo.user] = userPendingPayout
              }

              userPendingPayout.kudosCount++
              userPendingPayout.reactionCount += additionalReactionCount
              userPendingPayout.balanceInUsd += tipPerUser
            }
          } else {
            robot.log.trace(`${botName} - ${kudosTimestamp}: ${JSON.stringify(kudosReceivers)} only received ${reactionCount} reactions`)
          }
        } else {
          robot.log.trace(`${botName} - ${kudosTimestamp}: No receivers`)
        }

        if (!data.lastMessageTimestamp || messageTs > data.lastMessageTimestamp) {
          data.lastMessageTimestamp = messageTs
        }
      }

      if (!historyPayload.has_more) {
        robot.log.debug(`${botName} - Reached end of ${kudosChannelId} channel history`)
        break
      }
    } else {
      robot.log.debug(`${botName} - Failed to fetch ${kudosChannelId} channel history`)
      break
    }
  }

  return data
}

async function processPendingPayments (robot, data, saveStateAsyncFunc) {
  if (!process.env.DEBUG && !contractAddress) {
    return
  }

  const tokenPrice = await getTokenPrice(tokenID)
  const slackProfileCache = robot['slackProfileCache']

  const { contract, wallet } = tokenPayments.getContract(contractAddress, privateKey, token.network_id)

  // Sort users from lowest to highest balance
  const sortedUsers = Object.keys(data.userPendingPayouts).sort((a, b) => compareBalances(data.userPendingPayouts, a, b))

  // Print stats
  robot.log.debug(`User name\tAmount (${tokenID})\t# Kudos\t# Reactions\tPub key`)
  for (const slackUserId of sortedUsers) {
    const userPendingPayout = data.userPendingPayouts[slackUserId]
    const slackUsername = await slackProfileCache.getSlackUsernameFromSlackId(slackUserId)
    const pubkey = await slackProfileCache.getMainnetPubKeyFromSlackId(slackUserId)
    const tokenBalance = getTokenBalance(userPendingPayout.balanceInUsd, tokenPrice)

    robot.log.debug(`@${slackUsername}\t${tokenBalance}\t${userPendingPayout.kudosCount}\t${userPendingPayout.reactionCount}\t${pubkey}`)
  }

  // Make payments
  let totalPayments = 0
  for (const slackUserId of sortedUsers) {
    const userPendingPayout = data.userPendingPayouts[slackUserId]
    const slackUsername = await slackProfileCache.getSlackUsernameFromSlackId(slackUserId)
    const pubkey = await slackProfileCache.getMainnetPubKeyFromSlackId(slackUserId)

    if (pubkey && userPendingPayout.balanceInUsd > 0) {
      const tokenBalance = getTokenBalance(userPendingPayout.balanceInUsd, tokenPrice)
      totalPayments += tokenBalance

      try {
        const transaction = await tokenPayments.transfer(contract, wallet, pubkey, (process.env.DEBUG ? '0.0001' : tokenBalance.toString()))

        // Reset the outstanding payout values
        delete data.userPendingPayouts[slackUserId]
        robot.log.info(`${botName} - Made payment to @${slackUsername} (https://etherscan.io/tx/${transaction.hash}): ${JSON.stringify(transaction)}`)

        await saveStateAsyncFunc(data)
      } catch (error) {
        robot.log.warn(`${botName} - Failed to make payment to @${slackUsername}: ${error}`)
      }

      // Need to wait for a bit between transactions, otherwise we start receiving errors
      if (interTransactionDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, interTransactionDelay * 1000))
      }
    }
  }
  robot.log.debug(`Total payments: ${totalPayments}`)
}

function compareBalances (userToPendingPayouts, a, b) {
  const x = userToPendingPayouts[a]
  const y = userToPendingPayouts[b]

  if (x.balanceInUsd > y.balanceInUsd) {
    return 1
  }
  if (x.balanceInUsd < y.balanceInUsd) {
    return -1
  }
  return 0
}

function getTokenBalance (balanceInUsd, tokenPrice) {
  return Math.round(balanceInUsd / tokenPrice * 100) / 100
}

async function fetchKudosReceiversData (robot, kudosReceivers, slackWeb) {
  const slackProfileCache = robot['slackProfileCache']
  const result = []

  for (const user of kudosReceivers) {
    const pubkey = await slackProfileCache.getMainnetPubKeyFromSlackId(user)

    result.push({ user: user, pubkey: pubkey })
  }

  return result
}

function parseKudosReceivers (message) {
  const match = message.match(userIdRegex)

  const result = []
  if (match) {
    for (const k of match) {
      result.push(k.substring(1))
    }
  }
  return result
}

function countStarReactions (message, kudosReceivers) {
  let reactionCount = 0
  if (message.reactions) {
    const starsRegex = /&gt; \*(\d+) :star:s\s+\*/g
    reactionCount = getReactionCount(starsRegex, message.text)
    if (reactionCount === 0) {
      const reactionsRegex = /&gt; \*`(\d+)` Reactions?\s+\*/g
      reactionCount = getReactionCount(reactionsRegex, message.text)
    }
  }

  return reactionCount
}

function getReactionCount (regex, text) {
  let reactionCount = 0
  let m

  if ((m = regex.exec(text)) !== null) {
    reactionCount = parseInt(m[1])
  }

  return reactionCount
}

async function getTokenPrice (tokenID) {
  if (tokenID === 'STT') {
    tokenID = 'SNT'
  }

  const currency = 'USD'
  const response = await axios.get(`https://min-api.cryptocompare.com/data/price?fsym=${tokenID}&tsyms=${currency}`)
  const tokenPrice = parseFloat(response.data[currency])
  return tokenPrice
}
