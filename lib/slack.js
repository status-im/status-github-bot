// Description:
//   Configuration-related functionality
//
// Dependencies:
//   probot-slack-status: "^0.2.2"
//
// Author:
//   PombeirP

module.exports.sendMessage = async (robot, slackClient, room, message) => {
  // Send message to Slack
  if (slackClient != null) {
    // TODO BOUNTY migrate away from datastore:
    // https://github.com/slackapi/node-slack-sdk/wiki/DataStore-v3.x-Migration-Guide
    const channel = slackClient.dataStore.getChannelByName(room)
    try {
      if (process.env.DRY_RUN) {
        robot.log.debug(`Would have sent '${message}' to '${room}' channel`)
      } else {
        await slackClient.sendMessage(message, channel.id)
      }
    } catch (err) {
      robot.log.error(`Failed to send Slack message to '${room}' channel`)
    }
  } else {
    robot.log.debug('Slack client not available')
  }
}
