// Description:
//   Configuration-related functionality
//
// Dependencies:
//   js-yaml: "^3.10.0"
//
// Author:
//   PombeirP

module.exports = (robot, fileName) => {
  // Get document, or throw exception on error
  try {
    const yaml = require('js-yaml')
    const fs = require('fs')

    return yaml.safeLoad(fs.readFileSync(fileName, 'utf8'))
  } catch (e) {
    robot.log.error(e)
  }

  return null
}
