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
    const channel = slackClient.dataStore.getChannelByName(room)
    try {
      if (!process.env.DRY_RUN) {
        await slackClient.sendMessage(message, channel.id)
      }
    } catch(err) {
      robot.log.error(`Failed to send Slack message to ${room} channel`)
    }
  } else {
    robot.log.debug("Slack client not available")
  }
}
