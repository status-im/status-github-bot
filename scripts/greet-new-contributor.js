// Description:
//   Script that listens to new GitHub pull requests
//   and greets the user if it is their first PR on the repo
//
// Dependencies:
//   github: "^13.1.0"
//   probot-config "^0.1.0"
//   probot-slack-status: "^0.2.2"
//
// Author:
//   PombeirP

const getConfig = require('probot-config');
const Slack = require('probot-slack-status');

let slackClient = null;

module.exports = function(robot) {
  // robot.on('slack.connected', ({ slack }) => {
  Slack(robot, (slack) => {
    robot.log.trace("Connected, assigned slackClient");
    slackClient = slack;
  });

  robot.on('pull_request.opened', async context => {
    // Make sure we don't listen to our own messages
    if (context.isBot) { return; }
    
    // A new PR was opened
    await greetNewContributor(context, robot);
  });
};

async function greetNewContributor(context, robot) {
  const payload = context.payload;
  const github = context.github;
  const config = await getConfig(context, 'github-bot.yml')
  const welcomeMessage = config['new-pull-requests']['welcome-bot'].message;
  const ownerName = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const prNumber = payload.pull_request.number;
  
  robot.log(`greetNewContributor - Handling Pull Request #${prNumber} on repo ${ownerName}/${repoName}`);
  
  try {
    ghissues = await github.issues.getForRepo({
      owner: ownerName,
      repo: repoName,
      state: 'all',
      creator: payload.pull_request.user.login
    })
    
    const userPullRequests = ghissues.data.filter(issue => issue.pull_request);
    if (userPullRequests.length === 1) {
      try {
        await github.issues.createComment({
          owner: ownerName,
          repo: repoName,
          number: prNumber,
          body: welcomeMessage
        })
        
        // Send message to Slack
        if (slackClient != null) {
          const channel = slackClient.dataStore.getChannelByName(config.slack.notification.room);
          try {
            await slackClient.sendMessage(`Greeted ${payload.pull_request.user.login} on his first PR in the ${repoName} repo\n${payload.pull_request.html_url}`, channel.id);
          } catch(err) {
            robot.log.error(`Failed to send Slack message to ${config.slack.notification.room} channel`);
          }
        }
      } catch (err) {
        if (err.code !== 404) {
          robot.log.error(`Couldn't create comment on PR: ${err}`, ownerName, repoName);
        }
      }
    } else {
      robot.log.debug("This is not the user's first PR on the repo, ignoring", ownerName, repoName, payload.pull_request.user.login);
    }
  } catch (err) {
    robot.log.error(`Couldn't fetch the user's github issues for repo: ${err}`, ownerName, repoName);
  }
};