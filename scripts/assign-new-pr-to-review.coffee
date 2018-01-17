# Description:
#   Script that listens to new GitHub pull requests
#   and assigns them to the REVIEW column on the "Pipeline for QA" project
#
# Dependencies:
#   github: "^13.1.0"
#   hubot-github-webhook-listener: "^0.9.1"
#   hubot-slack: "^4.4.0"
#
# Notes:
#   The hard-coded names for the project board and review column are just below.
#   These could be read from a config file (e.g. YAML)
#   TODO: Rewrite this file with ES6 to benefit from async/await
#
# Author:
#   PombeirP

projectBoardName = "Pipeline for QA"
reviewColumnName = "REVIEW"
notifyRoomName = "core"

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
          assignPullRequestToReview context.github(), githubPayload, robot

assignPullRequestToReview = (github, githubPayload, robot) ->
  ownerName = githubPayload.repository.owner.login
  repoName = githubPayload.repository.name
  prNumber = githubPayload.pull_request.number
  robot.logger.info "assignPullRequestToReview - " +
    "Handling Pull Request ##{prNumber} on repo #{ownerName}/#{repoName}"

  # Fetch repo projects
  # TODO: The repo project and project column info should be cached
  # in order to improve performance and reduce roundtrips
  github.projects.getRepoProjects {
    owner: ownerName,
    repo: repoName,
    state: "open"
  }, (err, ghprojects) ->
    if err
      robot.logger.error "Couldn't fetch the github projects for repo: #{err}",
        ownerName, repoName
      return

    # Find "Pipeline for QA" project
    project = findProject ghprojects.data, projectBoardName
    if !project
      robot.logger.warn "Couldn't find project #{projectBoardName}" +
        " in repo #{ownerName}/#{repoName}"
      return
    
    robot.logger.debug "Fetched #{project.name} project (#{project.id})"

    # Fetch REVIEW column ID
    github.projects.getProjectColumns { project_id: project.id }, (err, ghcolumns) ->
      if err
        robot.logger.error "Couldn't fetch the github columns for project: #{err}",
          ownerName, repoName, project.id
        return

      column = findColumn ghcolumns.data, reviewColumnName
      if !column
        robot.logger.warn "Couldn't find #{projectBoardName} column" +
          " in project #{project.name}"
        return
      
      robot.logger.debug "Fetched #{column.name} column (#{column.id})"

      # Create project card for the PR in the REVIEW column
      github.projects.createProjectCard {
        column_id: column.id,
        content_type: 'PullRequest',
        content_id: githubPayload.pull_request.id
      }, (err, ghcard) ->
        if err
          robot.logger.error "Couldn't create project card for the PR: #{err}",
            column.id, githubPayload.pull_request.id
          return

        robot.logger.debug "Created card: #{ghcard.data.url}", ghcard.data.id

        # Send message to Slack
        robot.messageRoom notifyRoomName,
          "Moved PR #{githubPayload.pull_request.number} to " +
          "#{reviewColumnName} in #{projectBoardName} project"

findProject = (projects, name) ->
  for idx, project of projects
    return project if project.name == name
  return null

findColumn = (columns, name) ->
  for idx, column of columns
    return column if column.name == name
  return null
