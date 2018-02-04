// Description:
//   Configuration-related functionality
//
// Dependencies:
//   "mem-cache": "0.0.5"
//
// Author:
//   PombeirP

const { WebClient } = require('@slack/client')
const token = process.env.SLACK_USER_TOKEN || ''

module.exports.build = async (robot, cache) => {
  const web = new WebClient(token)
  await populateCache(robot, web, cache)
}

module.exports.getGitHubIdFromSlackUsername = (slackUsername, cache) => {
  return cache.get(getSlackCacheKeyName(slackUsername))
}

module.exports.getSlackUsernameFromGitHubId = (gitHubId, cache) => {
  return cache.get(getGitHubCacheKeyName(gitHubId))
}

async function populateCache (robot, web, cache) {
  robot.log.info('Populating Slack username cache...')

  try {
    const usersList = await web.users.list() // TODO: This call should be paginated to avoid hitting limits (memory, API): https://api.slack.com/docs/pagination#cursors
    const activeUsersList = usersList.members.filter(u => !u.deleted && !u.is_bot && u.id !== 'USLACKBOT')

    let gitHubFieldId = null
    let usersMissingGitHubInfo = []
    let usersContainingGitHubInfo = []
    let rateLimitWait = 10000
    let profileFetchPreviousBatchCount = 3
    let profileFetchBatchCount = 0
    for (let i = 0; i < activeUsersList.length;) {
      const user = activeUsersList[i]

      try {
        ++profileFetchBatchCount
        const { profile } = await web.users.profile.get({ user: user.id, include_labels: !gitHubFieldId })
        const username = profile.display_name_normalized || profile.real_name_normalized

        if (!gitHubFieldId) {
          // Find the field ID for the field with the 'Github ID' label
          gitHubFieldId = findGitHubLabelId(profile)
        }

        if (!gitHubFieldId) {
          robot.log.warn(`No GitHub ID field found in profile (@${username})!`)
          ++i
          continue
        }

        if (profile.fields && profile.fields[gitHubFieldId]) {
          const gitHubUsername = profile.fields[gitHubFieldId].value
          robot.log.debug(`@${username} -> ${gitHubUsername}`)

          cache.set(getSlackCacheKeyName(username), gitHubUsername)
          cache.set(getGitHubCacheKeyName(gitHubUsername), username)
          usersContainingGitHubInfo = usersContainingGitHubInfo.concat(username)
        } else {
          robot.log.warn(`@${username} (${user.id}) has no GitHub ID set`)
          usersMissingGitHubInfo = usersMissingGitHubInfo.concat(username)
        }

        ++i
        await sleep(1500)
      } catch (e) {
        if (e.name === 'Error' && e.message === 'ratelimited') {
          robot.log.trace(`Rate-limited, waiting ${rateLimitWait / 1000}s...`)
          await sleep(rateLimitWait)
          if (profileFetchBatchCount < profileFetchPreviousBatchCount) {
            // If we managed to fetch fewer profiles than the last time we got rate-limited, then try increasing the wait period
            rateLimitWait += 5000
          }
          profileFetchPreviousBatchCount = profileFetchBatchCount
          profileFetchBatchCount = 0
          continue
        }

        throw e
      }
    }
    robot.log.info(`Populated Slack username cache with ${usersContainingGitHubInfo.length} users: ${usersContainingGitHubInfo.map(s => '@' + s).join(', ')}`)
    if (usersMissingGitHubInfo) {
      robot.log.warn(`The following ${usersMissingGitHubInfo.length} Slack users have no GitHub info in their profiles: ${usersMissingGitHubInfo.map(s => '@' + s).join(', ')}`)
    }
  } catch (e) {
    robot.log.error(`Error while populating Slack username cache: ${e}`)
  }
}

function findGitHubLabelId (profile) {
  if (profile.fields) {
    for (const fieldId in profile.fields) {
      const field = profile.fields[fieldId]
      if (field.label === 'Github ID') {
        return fieldId
      }
    }
  }

  return null
}

function getSlackCacheKeyName (slackUsername) {
  return `Slack-${slackUsername}`
}

function getGitHubCacheKeyName (gitHubUsername) {
  return `GitHub-${gitHubUsername}`
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function sleep (timeoutMs) {
  await timeout(timeoutMs)
}
