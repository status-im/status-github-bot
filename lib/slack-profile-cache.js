// Description:
//   GitHub ID mapping to other connected systems (e.g. Slack)
//
// Dependencies:
//   mem-cache: "0.0.5"
//   memjs: "^1.2.0"
//   @slack/client: "^3.16.0"
//
// Author:
//   PombeirP

const MemCache = require('mem-cache')
const { WebClient } = require('@slack/client')

const token = process.env.SLACK_USER_TOKEN || ''
const slackWebClient = new WebClient(token)
const cacheMemcachedKey = 'slack-profile-cache-json'
const slackIdCacheKeyPrefix = 'Slack-'
const slackUsernameCacheKeyPrefix = 'SlackUN-'
const gitHubIdCacheKeyPrefix = 'GitHub-'
var allowLoadFromCache = true

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

  async getSlackIdFromSlackUsername (slackUsername) {
    await this.buildPromise
    const id = this.cache.get(getSlackUsername2IdCacheKeyName(slackUsername))
    return id
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

  async getMainnetPubKeyFromSlackId (slackUserId) {
    await this.buildPromise
    const profile = this.cache.get(getSlackId2ProfileCacheKeyName(slackUserId))
    if (profile) {
      return profile.pubkey
    }
    return null
  }
}

async function internalBuild (robot, cache) {
  const mc = robot['memcache']

  if (allowLoadFromCache && mc) {
    try {
      const json = await mc.get(cacheMemcachedKey)
      if (json.value) {
        const cacheFromFile = JSON.parse(json.value)
        for (const kvp of cacheFromFile) {
          if (kvp.k.startsWith(slackIdCacheKeyPrefix) && !kvp.v.hasOwnProperty('pubkey')) {
            cache.clean()
            break
          }
          cache.set(kvp.k, kvp.v)
          if (kvp.k.startsWith(slackIdCacheKeyPrefix)) {
            const profile = kvp.v
            cache.set(getSlackUsername2IdCacheKeyName(profile.name), kvp.k.substring(slackIdCacheKeyPrefix.length))
          }
        }
        allowLoadFromCache = false
        if (cache.length > 0) {
          robot.log.info(`Read Slack user cache from Memcached (${cache.length} entries)`)
          return
        }
      }
    } catch (error) {
      // Ignore
      robot.log.info('Could not find Slack user cache')
    }
  }

  robot.log.info('Populating Slack user ID cache...')

  try {
    const slackWeb = new WebClient(token) // We need to use a different token because users.profile API is not available to bot users
    const usersList = await getUsersList()
    const activeUsersList = usersList.filter(u => !u.deleted && !u.is_bot && u.id !== 'USLACKBOT')

    let gitHubFieldId = null
    let pubKeyFieldId = null
    let usersMissingGitHubInfo = []
    let usersMissingMainnetAddress = []
    let usersContainingGitHubInfo = []
    let usersWithMainnetPubkey = 0
    let rateLimitWait = 10000
    let profileFetchPreviousBatchCount = 3
    let profileFetchBatchCount = 0
    for (let i = 0; i < activeUsersList.length;) {
      const user = activeUsersList[i]

      try {
        ++profileFetchBatchCount
        const { profile } = await slackWeb.users.profile.get({ user: user.id, include_labels: !gitHubFieldId || !pubKeyFieldId })
        const username = profile.display_name_normalized || profile.real_name_normalized

        if (!gitHubFieldId) {
          // Find the field ID for the field with the 'Github ID' label
          gitHubFieldId = findProfileLabelId(profile, 'Github ID')
        }
        if (!pubKeyFieldId) {
          // Find the field ID for the field with the 'Mainnet Address' label
          pubKeyFieldId = findProfileLabelId(profile, 'Mainnet Address')
        }

        if (!gitHubFieldId) {
          robot.log.warn(`No GitHub ID field found in @${username} (${user.id}) profile!`)
        }
        if (!pubKeyFieldId) {
          robot.log.warn(`No Mainnet Address field found in @${username} (${user.id}) profile!`)
        }

        const gitHubUsername = gitHubFieldId && profile.fields && profile.fields[gitHubFieldId] ? profile.fields[gitHubFieldId].value.replace('https://github.com/', '') : null
        if (gitHubUsername) {
          usersContainingGitHubInfo = usersContainingGitHubInfo.concat(username)
        } else {
          usersMissingGitHubInfo = usersMissingGitHubInfo.concat(username)
        }

        const pubkey = profile.fields && profile.fields[pubKeyFieldId] ? profile.fields[pubKeyFieldId].value : null
        if (pubkey) {
          ++usersWithMainnetPubkey
        } else {
          usersMissingMainnetAddress = usersMissingMainnetAddress.concat(username)
        }

        const data = { name: username, github_handle: gitHubUsername, pubkey: pubkey }

        robot.log.debug(`@${username} (${user.id}) -> ${JSON.stringify(data)}`)

        cache.set(getSlackId2ProfileCacheKeyName(user.id), data)
        cache.set(getSlackUsername2IdCacheKeyName(username), user.id)
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
    if (usersMissingMainnetAddress) {
      robot.log.warn(`The following ${usersMissingMainnetAddress.length} Slack users have no Mainnet address in their profiles: ${usersMissingMainnetAddress.map(s => '@' + s).join(', ')}`)
    }
    robot.log.info(`${usersWithMainnetPubkey} users in ${activeUsersList.length} have a mainnet public key address configured`)

    // Write cache out to JSON file for faster startup next time
    const c = []
    for (const key of cache.keys) {
      c.push({ k: key, v: cache.get(key) })
    }

    if (mc) {
      try {
        await mc.set(cacheMemcachedKey, JSON.stringify(c, {}, 2), {})
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
  return slackIdCacheKeyPrefix.concat(slackUserId)
}

function getSlackUsername2IdCacheKeyName (slackUsername) {
  return slackUsernameCacheKeyPrefix.concat(slackUsername)
}

function getGitHub2SlackIdCacheKeyName (gitHubUsername) {
  return gitHubIdCacheKeyPrefix.concat(gitHubUsername)
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function sleep (timeoutMs) {
  await timeout(timeoutMs)
}

async function getUsersList (users = [], cursor = '') {
  const res = await slackWebClient.users.list({limit: 200, cursor: cursor})
  users = users.concat(res.members)

  if (!res.response_metadata.next_cursor) {
    return users
  }

  return getUsersList(users, res.response_metadata.next_cursor)
}
