// Description:
//   Script that handles startup tasks of the bot
//
// Dependencies:
//
// Author:
//   PombeirP

module.exports = function(robot) {

  robot.brain.on('loaded', function() {
    const gitHubContext = require('./github-context.js')();
  
    appID = robot.brain.get("github-app_id");
    if (appID) {
      gitHubContext.initialize(robot, appID);

      robot.logger.debug("Bot ready");
    } else {
      robot.logger.debug("Bot waiting to be installed");
    }
  })
}
