# Description:
#   Script that listens to new GitHub pull requests
#   and greets the user if it is their first PR on the repo
#
# Dependencies:
#   github: "^13.1.0"
#   hubot-github-webhook-listener: "^0.9.1"
#
# Notes:
#   TODO: Rewrite this file with ES6 to benefit from async/await
#
# Author:
#   PombeirP

module.exports = (robot) ->

  context = require('./github-context.coffee')

  robot.on "github-repo-event", (repo_event) ->
    githubPayload = repo_event.payload

    switch(repo_event.eventType)
      when "pull_request"
        context.initialize(robot, robot.brain.get "github-app_id")
        # Make sure we don't listen to our own messages
        return if context.equalsRobotName(robot, githubPayload.pull_request.user.login)

        action = githubPayload.action
        if action == "opened"
          # A new PR was opened
          greetNewContributor context.github(), githubPayload, robot

greetNewContributor = (github, githubPayload, robot) ->
  # TODO: Read the welcome message from a (per-repo?) file (e.g. status-react.welcome-msg.md)
  welcomeMessage = "Thanks for making your first PR here!"
  ownerName = githubPayload.repository.owner.login
  repoName = githubPayload.repository.name
  prNumber = githubPayload.pull_request.number
  robot.logger.info "greetNewContributor - " +
    "Handling Pull Request ##{prNumber} on repo #{ownerName}/#{repoName}"

  github.issues.getForRepo {
    owner: ownerName,
    repo: repoName
    state: 'all',
    creator: githubPayload.pull_request.user.login
  }, (err, ghissues) ->
    if err
      robot.logger.error "Couldn't fetch the user's github issues for repo: #{err}",
        ownerName, repoName
      return

    userPullRequests = ghissues.data.filter (issue) -> issue.pull_request
    if userPullRequests.length == 1
      github.issues.createComment {
        owner: ownerName,
        repo: repoName,
        number: prNumber,
        body: welcomeMessage
      }, (err, result) ->
        if err
          robot.logger.error("Couldn't fetch the github projects for repo: #{err}",
            ownerName, repoName) unless err.code == 404
          return
        robot.logger.info "Commented on PR with welcome message", ownerName, repoName
    else
      robot.logger.debug(
        "This is not the user's first PR on the repo, ignoring",
        ownerName, repoName, githubPayload.pull_request.user.login)