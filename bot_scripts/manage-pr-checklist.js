// Description:
//   Script that listens to GitHub pull requests events
//   and manages a checklist based on configuration in github-bot.yml
//   It sets the mergeable status based checklist state
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config: "^0.1.0"
//
// Author:
//   virneo

const fetch = require('node-fetch')
const getConfig = require('probot-config')
const defaultConfig = require('../lib/config')
const botName = 'manage-pr-checklist'

module.exports = (robot) => {
  robot.on(
    [
      'pull_request.opened',
      'pull_request.edited'
    ],
    context => {
      // Make sure we don't listen to our own messages
      if (context.isBot) { return }
      handlePullRequest(context, robot)
    })
  robot.on('issue_comment', context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return }
    handleIssue(context, robot)
  })
}

async function handleIssue (context, robot) {
  if (context.payload.issue.pull_request) {
    const res = await fetch(context.payload.issue.pull_request.url)
    const pr = await res.json()
    context.payload.pull_request = pr
    return handlePullRequest(context, robot)
  }
}

async function handlePullRequest (context, robot) {
  const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const settings = config ? config['prchecklist'] : null
  if (!settings) {
    return
  }
  if (settings.title == null) settings.title = ''
  if (settings.checklist == null) settings.checklist = {}
  const currentStatus = await getCurrentStatus(context)
  const {isChecklistComplete, firstCheck} = await verifyChecklist(context, settings)
  const newStatus = isChecklistComplete ? 'success' : 'pending'
  const hasChange = firstCheck || currentStatus !== newStatus
  const logStatus = isChecklistComplete ? '✅' : '⏳'
  const shortUrl = context.payload.pull_request.url

  if (!hasChange) {
    robot.log.info(`${botName} - 😐${logStatus} ${shortUrl}`)
    return
  }

  try {
    const {found, comment} = await getCheckListComment(context) 
    const targetUrl = 'https://github.com/status-im/status-github-bot.git'
    if (found) {
      targetUrl = comment.url 
    }

    await context.github.repos.createStatus(context.repo({
      sha: context.payload.pull_request.head.sha,
      state: newStatus,
      target_url: targetUrl,
      description: isChecklistComplete ? 'ready for merge' : 'PR Checklist is incomplete',
      context: 'PRChecklist'
    }))

    robot.log.info(`${botName} - 💾${logStatus} ${shortUrl}`)
  } catch (err) {
    robot.log.error(`${botName} - Couldn't create status for commits in the PR: ${err}`, context.payload.pull_request.id)
  }
}

async function getCurrentStatus (context) {
  const {data: {statuses}} = await context.github.repos.getCombinedStatusForRef(context.repo({
    ref: context.payload.pull_request.head.sha
  }))

  return (statuses.find(status => status.context === 'PRChecklist') || {}).state
}

async function createOrEditChecklist (context, checkList, header) {
  const owner = context.payload.repository.owner.login
  const repo = context.payload.repository.name
  const number = context.payload.pull_request.number
  if (checkList && checkList.length > 0) {
    let body = '<!--prchecklist--> \n### ' + header + '\n'
    for (const key of checkList) {
      body += '- [ ] ' + key + '\n'
    }
    await context.github.issues.createComment({ owner, repo, number, body })
  }
}

async function verifyChecklist (context, settings) {
  let isChecklistComplete = true
  let firstCheck = false
  const {found, body} = await getCheckListBody(context)
  if (found) {
    if (body) {
      for (const str of body) {
        const res = str.match(/(-\s\[(\s)])(.*)/gm)
        if (res != null) {
          isChecklistComplete = false
          break
        }
      }
    } else {
      isChecklistComplete = false
    }
  } else {
    await createOrEditChecklist(context, settings.checklist, settings.title)
    isChecklistComplete = false
    firstCheck = true
  }
  return {isChecklistComplete, firstCheck}
}

async function getCheckListComment (context) {
  try {
    const owner = context.payload.repository.owner.login
    const repo = context.payload.repository.name
    const number = context.payload.pull_request.number
    const comments = await context.github.paginate(context.github.issues.getComments({ owner, repo, number }), res => res.data)
    for (const comment of comments) {
      const {found} = checkPRChecklist(comment.body)
      if (found) {
        return {found, comment}
      }
    }
    return false
  } catch (e) {
    return true
  }
}

async function getCheckListBody (context) {
  const {found, comment} = await getCheckListComment(context) 
  if (found) {
    const {body} = checkPRChecklist(comment.body)

    return {found, body}
  }

  return false
}

function checkPRChecklist (str) {
  let found = false
  let body = null
  const isBotComment = str.match(/(<!--prchecklist-->)/g)
  if (isBotComment == null) return {found, body}
  let res = str.match(/(-\s\[(\s|x)])(.*)/gm)
  if (res && res.length > 0) {
    found = true
    body = res
  }
  return {found, body}
}
