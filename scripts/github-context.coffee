# Description:
#   Script that keeps GitHub-related context to be shared among scripts
#
# Dependencies:
#   github: "^13.1.0"
#   jwt-simple: "^0.5.1"
#
# Author:
#   PombeirP

GitHubApi = require('github')

RegExp cachedRobotNameRegex = null
initialized = false
githubAPI = new GitHubApi { version: "3.0.0" }

module.exports = {

  github: -> githubAPI

  initialize: (robot, integrationID) ->
    return if initialized

    token = robot.brain.get('github-token')
    if token
      initialized = true
      process.env.HUBOT_GITHUB_TOKEN = token
      robot.logger.debug "Reused cached GitHub token"
      githubAPI.authenticate({ type: 'token', token: token })
      return

    pemFilePath = './status-github-bot.pem'

    jwt = require('jwt-simple')

    # Private key contents
    privateKey = ''
    try
      fs = require('fs')
      privateKey = fs.readFileSync pemFilePath
    catch err
      robot.logger.error "Couldn't read #{pemFilePath} file contents: #{err}"
      return

    now = Math.round(Date.now() / 1000)
    # Generate the JWT
    payload = {
      # issued at time
      iat: now,
      # JWT expiration time (10 minute maximum)
      exp: now + (1 * 60),
      # GitHub App's identifier
      iss: integrationID
    }

    jwt = jwt.encode(payload, privateKey, 'RS256')
    githubAPI.authenticate({
      type: 'integration',
      token: jwt
    })
    robot.logger.debug "Configured integration authentication with JWT", jwt

    initialized = true

  equalsRobotName: (robot, str) ->
    return getRegexForRobotName(robot).test(str)
}

getRegexForRobotName = (robot) ->
  # This comes straight out of Hubot's Robot.coffee
  # - they didn't get a nice way of extracting that method though
  if !cachedRobotNameRegex
    name = robot.name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')

    if robot.alias
      alias = robot.alias.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
      namePattern = "^\\s*[@]?(?:#{alias}|#{name})"
    else
      namePattern = "^\\s*[@]?#{name}"
    cachedRobotNameRegex = new RegExp(namePattern, 'i')
  return cachedRobotNameRegex
