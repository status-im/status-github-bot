// Description:
//   GitHub ID mapping to other connected systems (e.g. Slack)
//
// Dependencies:
//   mem-cache: "0.0.5"
//   @slack/client: "^3.16.0"
//
// Author:
//   PombeirP

const MemCache = require('mem-cache')
const memjs = require('memjs')
const { WebClient } = require('@slack/client')

const token = process.env.SLACK_USER_TOKEN || ''
const cacheMemcachedKey = 'slack-profile-cache-json'
var allowLoadFromCache = true

// Environment variables are defined in app.yaml.
let MEMCACHE_URL = process.env.MEMCACHE_URL || '127.0.0.1:11211'
if (process.env.USE_GAE_MEMCACHE) {
  MEMCACHE_URL = `${process.env.GAE_MEMCACHE_HOST}:${process.env.GAE_MEMCACHE_PORT}`
}
const mc = memjs.Client.create(MEMCACHE_URL, {
  username: process.env.MEMCACHE_USERNAME,
  password: process.env.MEMCACHE_PASSWORD
})

module.exports = (robot) => new GitHubSlackIdMapper(robot)

class GitHubSlackIdMapper {
  constructor (robot) {
    this.robot = robot
    this.cache = new MemCache({ timeoutDisabled: true })
    this.buildPromise = new Promise((resolve, reject) => internalBuild(this.robot, this.cache).then(resolve).catch(reject))

    // Refresh cache every day
    setInterval(() => internalBuild(this.robot, this.cache), 24 * 60 * 60 * 1000)
  }

  async getSlackUsernameFromSlackId (slackUserId) {
    await this.buildPromise
    const profile = this.cache.get(getSlackId2ProfileCacheKeyName(slackUserId))
    if (profile) {
      return profile.name
    }
    return null
  }

  async getGitHubHandleFromSlackId (slackUserId) {
    await this.buildPromise
    const profile = this.cache.get(getSlackId2ProfileCacheKeyName(slackUserId))
    if (profile) {
      return profile.github_handle
    }
    return null
  }

  async getSlackIdFromGitHubId (gitHubId) {
    await this.buildPromise
    return this.cache.get(getGitHub2SlackIdCacheKeyName(gitHubId))
  }

  async getSlackMentionFromGitHubId (gitHubId) {
    const id = await this.getSlackIdFromGitHubId(gitHubId)
    if (!id) {
      return null
    }
    return `<@${id}>`
  }
}

async function internalBuild (robot, cache) {
  if (allowLoadFromCache) {
    try {
      const json = await mc.get(cacheMemcachedKey)
      if (json.value) {
        const cacheFromFile = JSON.parse(json.value)
        for (const kvp of cacheFromFile) {
          cache.set(kvp.k, kvp.v)
        }
        robot.log.info(`Read Slack user cache from ${MEMCACHE_URL} (${cache.length} entries)`)
        allowLoadFromCache = false
        return
      }
    } catch (error) {
      // Ignore
      robot.log.info('Could not find Slack user cache')
    }
  }

  robot.log.info('Populating Slack user ID cache...')

  try {
    const slackWeb = new WebClient(token) // We need to use a different token because users.profile API is not available to bot users
    const usersList = await slackWeb.users.list() // TODO: This call should be paginated to avoid hitting limits (memory, API): https://api.slack.com/docs/pagination#cursors
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
        const { profile } = await slackWeb.users.profile.get({ user: user.id, include_labels: !gitHubFieldId })
        const username = profile.display_name_normalized || profile.real_name_normalized

        if (!gitHubFieldId) {
          // Find the field ID for the field with the 'Github ID' label
          gitHubFieldId = findProfileLabelId(profile, 'Github ID')
        }

        if (!gitHubFieldId) {
          robot.log.warn(`No GitHub ID field found in @${username} (${user.id}) profile!`)
        }

        const gitHubUsername = gitHubFieldId && profile.fields && profile.fields[gitHubFieldId] ? profile.fields[gitHubFieldId].value.replace('https://github.com/', '') : null
        if (gitHubUsername) {
          usersContainingGitHubInfo = usersContainingGitHubInfo.concat(username)
        } else {
          usersMissingGitHubInfo = usersMissingGitHubInfo.concat(username)
        }

        const data = { name: username, github_handle: gitHubUsername }

        robot.log.debug(`@${username} (${user.id}) -> ${JSON.stringify(data)}`)

        cache.set(getSlackId2ProfileCacheKeyName(user.id), data)
        if (gitHubUsername) {
          cache.set(getGitHub2SlackIdCacheKeyName(gitHubUsername), user.id)
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
    robot.log.info(`Populated Slack user ID cache with ${usersContainingGitHubInfo.length} users: ${usersContainingGitHubInfo.map(s => '@' + s).join(', ')}`)
    if (usersMissingGitHubInfo) {
      robot.log.warn(`The following ${usersMissingGitHubInfo.length} Slack users have no GitHub info in their profiles: ${usersMissingGitHubInfo.map(s => '@' + s).join(', ')}`)
    }

    // Write cache out to JSON file for faster startup next time
    const c = []
    for (const key of cache.keys) {
      c.push({ k: key, v: cache.get(key) })
    }

    if (mc) {
      try {
        await mc.set(cacheMemcachedKey, c, {})
        robot.log.info(`Saved cache to Memcached`)
      } catch (error) {
        robot.log.warn(`Error while saving cache to Memcached: ${error}`)
      }
    }
  } catch (e) {
    robot.log.error(`Error while populating Slack user ID cache: ${e}`)
  }
}

function findProfileLabelId (profile, labelName) {
  if (profile.fields) {
    for (const fieldId in profile.fields) {
      const field = profile.fields[fieldId]
      if (field.label === labelName) {
        return fieldId
      }
    }
  }

  return null
}

function getSlackId2ProfileCacheKeyName (slackUserId) {
  return `Slack-${slackUserId}`
}

function getGitHub2SlackIdCacheKeyName (gitHubUsername) {
  return `GitHub-${gitHubUsername}`
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function sleep (timeoutMs) {
  await timeout(timeoutMs)
}
