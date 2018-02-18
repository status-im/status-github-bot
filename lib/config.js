// Description:
//   Configuration-related functionality
//
// Dependencies:
//   js-yaml: "^3.10.0"
//
// Author:
//   PombeirP + martinklepsch

function readYaml (fileName) {
  const yaml = require('js-yaml')
  const fs = require('fs')

  return yaml.safeLoad(fs.readFileSync(fileName, 'utf8'))
}

function getConfig () {
  return readYaml('config.yml')
}

module.exports = (robot, fileName) => {
  // Get document, or throw exception on error
  try {
    return readYaml(fileName)
  } catch (e) {
    robot.log.error(e)
  }

  return null
}

module.exports.enabled = (botName) => {
  return getConfig()[botName]['defaultEnabled']
}

module.exports.forRepo = (botName, repoName) => {
  return getConfig()[botName]['repoConfig'][repoName]
}

module.exports.enabledForRepo = (botName, repoName) => {
  let config = getConfig()

  // TODO: how to use `forRepo` here?
  if (config[botName]['repoConfig'][repoName]['disabled']) {
    return false
  } else if (config[botName]['defaultEnabled']) {
    return true
  } else {
    return false
  }
}
