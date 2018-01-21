// Description:
//   Script that handles startup tasks of the bot
//
// Dependencies:
//
// Author:
//   PombeirP

let initializing = false;

module.exports = function(robot) {

  robot.brain.on('loaded', async function() {
    if (initializing) {
      return;
    }

    initializing = true;

    try {
      const gitHubContext = require('./github-context.js')();
    
      appID = robot.brain.get("github-app_id");
      installationID = robot.brain.get("github-installation_id");
      if (installationID) {
        await gitHubContext.initialize(robot, appID, installationID);

        robot.logger.debug("Bot ready");
      } else {
        robot.logger.debug("Bot waiting to be installed");
      }
    } catch(err) {
      robot.logger.error(err);
    } finally {
      initializing = false;
    }
  })
}
