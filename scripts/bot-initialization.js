// Description:
//   Script that handles startup tasks of the bot
//
// Dependencies:
//
// Author:
//   PombeirP

module.exports = function(robot) {

  robot.brain.on('loaded', function() {
    const context = require('./github-context.js');
  
    appID = robot.brain.get("github-app_id");
    if (appID) {
      context.initialize(robot, appID);

      robot.logger.debug("Bot ready");
    } else {
      robot.logger.debug("Bot waiting to be installed");
    }
  })
}
