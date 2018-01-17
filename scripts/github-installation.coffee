# Description:
#   Script that handles the installation of the GitHub app
#
# Dependencies:
#   github: "^13.1.0"
#   hubot-github-webhook-listener: "^0.9.1"
#
# Author:
#   PombeirP

module.exports = (robot) ->

  context = require('./github-context.coffee')

  robot.on "github-repo-event", (repo_event) ->
    githubPayload = repo_event.payload

    switch(repo_event.eventType)
      when "integration_installation"
        # Make sure we don't listen to our own messages
        return if context.equalsRobotName(robot, githubPayload.sender.login)

        action = githubPayload.action
        switch action
          when "created"
            # App was installed on an organization
            robot.logger.info "Initializing installation for app with ID " +
              "#{githubPayload.installation.app_id} and " +
              "installation ID #{githubPayload.installation.id}"

            robot.brain.set 'github-app_install-payload', JSON.stringify(githubPayload)
            robot.brain.set 'github-app_id', githubPayload.installation.app_id
            robot.brain.set 'github-app_repositories',
              (x.full_name for x in githubPayload.repositories).join()

            context.initialize(robot, githubPayload.installation.app_id)

            perms = githubPayload.installation.permissions
            robot.logger.error formatPermMessage('repository_projects', 'write') unless perms.repository_projects == 'write'
            robot.logger.error formatPermMessage('metadata', 'read') unless perms.metadata == 'read'
            robot.logger.error formatPermMessage('issues', 'read') unless perms.issues == 'read'
            robot.logger.error formatPermMessage('pull_requests', 'write') unless perms.pull_requests == 'write'
            
            robot.logger.error "Please enable 'pull_request' events " +
              "in the app configuration on github.com" unless 'pull_request' in githubPayload.installation.events

            createAccessToken robot, context.github(), githubPayload.installation.id
          when "deleted"
            # App was uninstalled from an organization
            robot.logger.info "Removing installation for app " +
              "with ID #{githubPayload.installation.app_id} and " +
              "installation ID #{githubPayload.installation.id}"

            robot.brain.set 'github-app_id', null
            robot.brain.set 'github-app_install-payload', null
            robot.brain.set 'github-app_repositories', null
            robot.brain.set 'github-token', null
            process.env.HUBOT_GITHUB_TOKEN = null

createAccessToken = (robot, github, id) ->
  github.apps.createInstallationToken { installation_id: id }, (err, response) ->
      if err
        robot.logger.error "Couldn't create installation token: #{err}", id
        return

      console.error response.data.token
      robot.brain.set 'github-token', response.data.token
      # TODO: Set Redis expiration date to value from response.data.expires_at
      process.env.HUBOT_GITHUB_TOKEN = response.data.token
      github.authenticate({
        type: 'token',
        token: response.data.token
      })

formatPermMessage = (permName, perm) ->
  "Please enable '#{permName}' #{perm} permission in the app configuration on github.com"