// ISC License

// Copyright (c) 2017, Tom McKenzie <tom@chillidonut.com>

// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.

// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

const RtmClient = require('@slack/client').RtmClient
const WebClient = require('@slack/client').WebClient
const CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS
const RTM_EVENTS = require('@slack/client').RTM_EVENTS

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || ''

module.exports.BotUserName = 'probot'

module.exports = (robot, connectCallback) => {
  if (!BOT_TOKEN) {
    robot.log.error('SLACK_BOT_TOKEN missing, skipping Slack integration')
    return
  }

  function emit (payload) {
    robot.receive({
      event: 'slack',
      payload: {
        ...payload,
        installation: {}, // We need to add an 'installation' property, otherwise node_modules/probot/lib/robot.js:100 will throw an exception
        slack: SlackAPI,
        slackWeb: SlackWebAPI
      }
    })
  }

  robot.log.trace('Slack connecting...')

  // game start!
  const SlackAPI = new RtmClient(BOT_TOKEN)
  const SlackWebAPI = new WebClient(BOT_TOKEN)

  // The client will emit an RTM.AUTHENTICATED event on successful connection, with the `rtm.start` payload
  SlackAPI.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
    robot.log.trace('Slack successfully authenticated')

    emit({
      action: 'authenticated',
      payload: rtmStartData
    })
  })

  // you need to wait for the client to fully connect before you can send messages
  SlackAPI.on(CLIENT_EVENTS.RTM.RTM_CONNECTION_OPENED, () => {
    robot.log.info('Slack connected')

    emit({
      action: 'connected'
    })

    connectCallback(SlackAPI)
  })

  // bind to all supported events <https://api.slack.com/events>
  for (const event in RTM_EVENTS) {
    SlackAPI.on(event, (payload) => {
      emit({
        action: event,
        payload
      })
    })
  }

  // now connect
  SlackAPI.connect('https://slack.com/api/rtm.connect')
}

module.exports.sendMessage = async (robot, room, message) => {
  // Send message to Slack
  if (robot.slack) {
    // TODO BOUNTY migrate away from datastore:
    // https://github.com/slackapi/node-slack-sdk/wiki/DataStore-v3.x-Migration-Guide
    const channel = robot.slack.dataStore.getChannelByName(room)
    try {
      if (process.env.DRY_RUN) {
        robot.log.debug(`Would have sent '${message}' to '${room}' channel`)
      } else {
        await robot.slack.sendMessage(message, channel.id)
      }
    } catch (err) {
      robot.log.error(`Failed to send Slack message to '${room}' channel`)
    }
  } else {
    robot.log.debug('Slack client not available')
  }
}
