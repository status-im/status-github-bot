// Description:
//   A GitHub App built with Probot that closes abandoned Issues and Pull Requests after a period of inactivity. https://probot.github.io/apps/stale/
//
// Dependencies:
//   github: "^13.1.0"
//   joi: "^13.1.2"
//   probot-config: "^0.1.0"
//   probot-scheduler: "^1.2.0"
//
// Author:
//   https://probot.github.io/apps/stale/

const getConfig = require('probot-config')
const createScheduler = require('probot-scheduler')
const defaultConfig = require('../../lib/config')
const Stale = require('./lib/stale')

module.exports = async app => {
  // Visit all repositories to mark and sweep stale issues
  const scheduler = createScheduler(app)

  // Unmark stale issues if a user comments
  const events = [
    'issue_comment',
    'issues',
    'pull_request',
    'pull_request_review',
    'pull_request_review_comment'
  ]

  app.on(events, context => unmark(app, context))
  app.on('schedule.repository', context => markAndSweep(app, context))

  async function unmark (robot, context) {
    if (!context.isBot) {
      const stale = await forRepository(robot, context)
      let issue = context.payload.issue || context.payload.pull_request
      const type = context.payload.issue ? 'issues' : 'pulls'

      // Some payloads don't include labels
      if (!issue.labels) {
        try {
          issue = (await context.github.issues.get(context.issue())).data
        } catch (error) {
          context.log('Issue not found')
        }
      }

      const staleLabelAdded = context.payload.action === 'labeled' &&
        context.payload.label.name === stale.config.staleLabel

      if (stale.hasStaleLabel(type, issue) && issue.state !== 'closed' && !staleLabelAdded) {
        stale.unmark(type, issue)
      }
    }
  }

  async function markAndSweep (robot, context) {
    const stale = await forRepository(robot, context)
    await stale.markAndSweep('pulls')
    await stale.markAndSweep('issues')
  }

  async function forRepository (robot, context) {
    let config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))

    if (config) {
      config = config.stale
    }

    if (!config) {
      scheduler.stop(context.payload.repository)
      // Don't actually perform for repository without a config
      config = { perform: false }
    }

    config = Object.assign(config, context.repo({ logger: app.log }))

    return new Stale(context.github, config)
  }
}
