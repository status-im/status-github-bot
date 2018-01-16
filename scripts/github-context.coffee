# Description:
#   Script that keeps GitHub-related context to be shared among scripts

GitHubApi = require("github")

RegExp cachedRobotNameRegex = null
initialized = false
github = new GitHubApi { version: "3.0.0" }

module.exports.github = github

module.exports.initialize = ->
    return if initialized

    initialized = true
    github.authenticate({
        type: "token",
        token: process.env.HUBOT_GITHUB_TOKEN
    })

module.exports.equalsRobotName = (robot, str) ->
    return module.exports.getRegexForRobotName(robot).test(str)

module.exports.getRegexForRobotName = (robot) ->
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
