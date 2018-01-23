// Description:
//   Script that listens to GitHub pull reviews
//   and assigns the PR to TO TEST column on the "Pipeline for QA" project
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config "^0.1.0"
//   probot-slack-status: "^0.2.2"
//
// Author:
//   PombeirP

const getConfig = require('probot-config')
const defaultConfig = require('../lib/config')
const Slack = require('probot-slack-status')

let slackClient = null

module.exports = function(robot) {
  // robot.on('slack.connected', ({ slack }) => {
  Slack(robot, (slack) => {
    robot.log.trace("Connected, assigned slackClient")
    slackClient = slack
  })
  
  robot.on('pull_request_review.submitted', context => assignPullRequestToTest(context, robot))
  robot.on('pull_request_review.edited', context => assignPullRequestToTest(context, robot))
}

async function getReviewApprovalState(github, payload) {
  const ownerName = payload.repository.owner.login
  const repoName = payload.repository.name
  const prNumber = payload.pull_request.number

  const ghreviews = await github.pullRequests.getReviews({owner: ownerName, repo: repoName, number: prNumber})
  const approvedReviews = ghreviews.data.filter(review => review.state === 'APPROVED')
  if (approvedReviews.length >= 2) {
    return 'approved'
  }
  
  return 'pending'
}

async function getProjectCardForPullRequest(github, robot, columnId, pullRequestUrl) {
  const ghcards = await github.projects.getProjectCards({column_id: columnId})
  ghcard = ghcards.data.find(c => c.content_url === pullRequestUrl)
  
  return ghcard
}

async function assignPullRequestToTest(context, robot) {
  // Make sure we don't listen to our own messages
  if (context.isBot) { return }
  
  const payload = context.payload
  const github = context.github
  //const config = await getConfig(context, 'github-bot.yml', defaultConfig(robot, '.github/github-bot.yml'))
  const config = defaultConfig(robot, '.github/github-bot.yml')
  const ownerName = payload.repository.owner.login
  const repoName = payload.repository.name
  const prNumber = payload.pull_request.number
  
  if (!config['project-board']) {
    return;
  }
  
  robot.log(`assignPullRequestToTest - Handling Pull Request #${prNumber} on repo ${ownerName}/${repoName}`)
  
  state = getReviewApprovalState(github, payload)
  
  const reviewColumnName = config['project-board']['review-column-name']
  const testColumnName = config['project-board']['test-column-name']
  if (state === 'approved') {
    srcColumnName = reviewColumnName
    dstColumnName = testColumnName
  } else {
    srcColumnName = testColumnName
    dstColumnName = reviewColumnName
  }
  
  // Fetch repo projects
  // TODO: The repo project and project column info should be cached
  // in order to improve performance and reduce roundtrips
  try {
    ghprojects = await github.projects.getRepoProjects({
      owner: ownerName,
      repo: repoName,
      state: "open"
    })
    
    // Find "Pipeline for QA" project
    const projectBoardName = config['project-board'].name
    const project = ghprojects.data.find(p => p.name === projectBoardName)
    if (!project) {
      robot.log.error(`Couldn't find project ${projectBoardName} in repo ${ownerName}/${repoName}`)
      return
    }
    
    robot.log.debug(`Fetched ${project.name} project (${project.id})`)
    
    // Fetch column IDs
    try {
      ghcolumns = await github.projects.getProjectColumns({ project_id: project.id })  
      
      const srcColumn = ghcolumns.data.find(c => c.name === srcColumnName)
      if (!srcColumn) {
        robot.log.error(`Couldn't find ${srcColumnName} column in project ${project.name}`)
        return
      }
      
      const dstColumn = ghcolumns.data.find(c => c.name === dstColumnName)
      if (!dstColumn) {
        robot.log.error(`Couldn't find ${dstColumnName} column in project ${project.name}`)
        return
      }
      
      robot.log.debug(`Fetched ${srcColumn.name} (${srcColumn.id}), ${dstColumn.name} (${dstColumn.id}) columns`)
      
      // Move PR card to the destination column
      let ghcard = null
      try {
        ghcard = await getProjectCardForPullRequest(github, robot, srcColumn.id, payload.pull_request.issue_url)
      } catch (err) {
        robot.log.error(`Failed to retrieve project card for the PR, aborting: ${err}`, srcColumn.id, payload.pull_request.issue_url)
        return
      }

      if (ghcard) {
        try {
          robot.log.trace(`Found card in source column ${ghcard.id}`, srcColumn.id)

          // Found in the source column, let's move it to the destination column
          await github.projects.moveProjectCard({id: ghcard.id, position: 'bottom', column_id: dstColumn.id})
          
          robot.log.debug(`Moved card: ${ghcard.url}`, ghcard.id)
        } catch (err) {
          robot.log.error(`Couldn't move project card for the PR: ${err}`, srcColumn.id, dstColumn.id, payload.pull_request.id)
          return
        }
      } else {
        try {
          robot.log.debug(`Didn't find card in source column`, srcColumn.id)

          // It wasn't in source column, let's create a new card for it in the destination column
          ghcard = await github.projects.createProjectCard({
            column_id: dstColumn.id,
            content_type: 'PullRequest',
            content_id: payload.pull_request.id
          })
          
          robot.log.debug(`Created card: ${ghcard.data.url}`, ghcard.data.id)
        } catch (err) {
          robot.log.error(`Couldn't create project card for the PR: ${err}`, dstColumn.id, payload.pull_request.id)
          return
        }
      }
        
      // Send message to Slack
      const slackHelper = require('../lib/slack')
      slackHelper.sendMessage(robot, slackClient, config.slack.notification.room, `Assigned PR to ${dstColumnName} in ${projectBoardName} project\n${payload.pull_request.html_url}`)
    } catch (err) {
      robot.log.error(`Couldn't fetch the github columns for project: ${err}`, ownerName, repoName, project.id)
    }
  } catch (err) {
    robot.log.error(`Couldn't fetch the github projects for repo: ${err}`, ownerName, repoName)
  }
}
