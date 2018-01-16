# Description:
#   Script that listens to new GitHub pull requests
#   and assigns them to the REVIEW column on the "Pipeline for QA" project

module.exports = (robot) ->

  context = require("./github-context.coffee")

  robot.on "github-repo-event", (repo_event) ->
    githubPayload = repo_event.payload

    switch(repo_event.eventType)
      when "pull_request"
        # Make sure we don't listen to our own messages
        return if context.equalsRobotName(robot, githubPayload.pull_request.user.login)
        return console.error "No Github token provided to Hubot" unless process.env.HUBOT_GITHUB_TOKEN

        action = githubPayload.action
        if action == "opened"
          # A new PR was opened
          context.initialize()

          greetNewContributor context.github, githubPayload, robot

greetNewContributor = (github, githubPayload, robot) ->
  welcomeMessage = "Thanks for making your first PR here!" # TODO: Read the welcome message from a (per-repo?) file (e.g. status-react.welcome-msg.md)
  ownerName = githubPayload.repository.owner.login
  repoName = githubPayload.repository.name
  prNumber = githubPayload.pull_request.number
  robot.logger.info "greetNewContributor - Handling Pull Request ##{prNumber} on repo #{ownerName}/#{repoName}"

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
        robot.logger.error "Couldn't fetch the github projects for repo: #{err}", ownerName, repoName unless err.code == 404
      robot.logger.info "Commented on PR with welcome message", ownerName, repoName
    else
      robot.logger.debug "This is not the user's first PR on the repo, ignoring", ownerName, repoName, githubPayload.pull_request.user.login