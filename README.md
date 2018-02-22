# statusbot

statusbot is a chat bot built on the [Probot][probot] framework. There's a wiki available [here][wiki].

This README is intended to help get you started. Definitely update and improve
to talk about your own instance, how to use and deploy, what functionality is
available, etc!

[probot]: https://probot.github.io/docs/deployment/
[wiki]: https://wiki.status.im/GitHub_bot

## What does the bot do?

- Background management in GitHub:
  - Assign new PRs to the `Pipeline for QA` project board (`REVIEW` column).
  - Move existing PRs to the correct `Pipeline for QA` project board column (`REVIEW`/`IN TEST`) depending on whether or not the required conditions are met (is mergeable, at least two reviewers have approved and there is no request for changes).
  - Assign issues that are labeled `bounty-awaiting-approval` to the `Status SOB Swarm` project board (`bounty-awaiting-approval` column).
  - Welcome users who post their first PR in a project.
  - Checks if all commits are GPG-signed and sets the PR status accordingly.
  - Unfurls links on Issues and Pull Request discussions.
  - Disallows merging of PRs containing WIP in the title.
  - Mention repo collaborators on Slack when a GHI is assigned the `bounty-awaiting-approval` label.
  - When a PR is moved to the IN TEST column and the build has passed successfully, then the bot will kick a test automation build in Jenkins (retrying periodically if the PR build is still running).
  - New functionality will be added in the future (wishlist is being tracked [here](https://docs.google.com/document/d/19NZEJ453av-owAEBXcIPjavbGKMBFlfVcwsuQ_ORzR4/))

The project board names, column names, welcome message and other values are stored in the `.github/github-bot.yml` file. It can be overriden for each specific repository by adding a file in the same path on the respective repository (see [probot-config](https://github.com/getsentry/probot-config)).

## Development

To get your environment set up go through the following steps:

1. Run `npm install`
2. Populate `.env`

   ```sh
   cp .env.example .env
   # edit .env file to contain proper config
   ```

After this you can start the bot by running:
```sh
npm start
```

## Creating the Slack Bot Integration

1. Go to https://my.slack.com/services/new/bot
2. Add a bot integration
3. Note the bot token starting with `xoxb-` and put it into `.env`

## Creating the bot GitHub App

This bot is meant to be packaged as a GitHub App. There are two steps to it: creating the app, and installing the app. Creating a GitHub App only needs to be done once and the app can be made public to be reused for any number of repositories and organizations.

See the official [docs for deployment](https://probot.github.io/docs/deployment/).

1. Create the GitHub App:
    1. In GitHub, go to `Settings/Developer settings/GitHub Apps` and click on `New GitHub App`
    1. Enter the bot name in `GitHub App name`, e.g. `Status GitHub Bot`
    1. In `Homepage URL`, enter the `/ping` endpoint of the service, e.g. https://5e63b0ab.ngrok.io/ping
    1. In `Webhook URL`, enter the root endpoint of the service, e.g. https://5e63b0ab.ngrok.io/
    1. In `Webhook secret (optional)`, enter a string of characters that matches the value passed in the in the `WEBHOOK_SECRET` environment variable.
    1. This app requires these **Permissions & events** for the GitHub App:
        - Commit statuses - **Read & write**
        - Issues - **Read & Write**
            - [x] Check the box for **Issue comment** events
            - [x] Check the box for **Issues** events
        - Pull requests - **Read & Write**
            - [x] Check the box for **Pull request** events
            - [x] Check the box for **Pull request review** events
            - [x] Check the box for **Pull request review comment** events
        - Repository contents - **Read-only**
            - [x] Check the box for **Push** events
        - Repository projects - **Read & Write**
            - [x] Check the box for **Project for repository projects** events
            - [x] Check the box for **Project card for repository projects** events
        - Organization projects - **Read-only**
            - [x] Check the box for **Project for organization projects** events
        - Single File - **Read-only**
            - Path: `.github/github-bot.yml`
    1. 🔍  Verify that you have **ticked 9 boxes**.
    1. Generate a private key pass and save it.
1. Installing the bot service:
    1. Deploy the bot to the cloud.
    1. Set the `APP_ID` environment variable to value reported when the GitHub App was created.
    1. Set the `WEBHOOK_SECRET` environment variable to the value configured in the GitHub App.
    1. Set the `PRIVATE_KEY` environment variable to the contents of the `.pem` file.
    1. Set the `SLACK_BOT_TOKEN` environment variable to the value reported for the bot in [Slack](https://status-im.slack.com/apps/).
1. Install the GitHub App in an account:
    1. Select the repositories where the bot should work (e.g. `status-react`).

## Customizing the bot

The bot gets its settings from a per-repo file located at `.github/github-bot.yml`. That file extends the [base file](https://github.com/status-im/probot-settings/blob/master/.github/github-bot.yml) at the status-im/probot-settings repo.

Examples of settings that can be configured:

- `github-team/slug`: Slug of the team that owns the respective repository
- `welcome-bot/message-template`: First time contributor welcome message template. Examples of template values allowed:

  - `{user}`: Replaced by the PR submitter's user name
  - `{repo-name}`: Replaced by the PR's target repository name
  - `{pr-number}`: Replaced by the PR number

- `slack/notification/room`: Slack room used for notifications (e.g. `status-probot`)

- Repository project board settings:

  - `project-board/name`: Name of the QA pipeline project board
  - `project-board/contributor-column-name`: Name of the column in the project board to group issues that are being worked on by a contributor
  - `project-board/review-column-name`: Name of the column in the project board to group issues that are up for review
  - `project-board/test-column-name`: Name of the column in the project board to group issues that up for testing by QA

- Bounty project board settings:

  - `bounty-project-board/name`: Name of the bounty project board in GitHub
  - `bounty-project-board/owner`: GitHub username of the maintainer of the bounty project board (used to e.g. send Slack notifications)
  - `bounty-project-board/awaiting-approval-column-name`: Name of the column in the bounty project board to group issues that are awaiting for bounty approval
  - `bounty-project-board/awaiting-approval-label-name`: Name of the label used in issues to declare that an issue is awaiting approval to become a bounty
  - `bounty-project-board/bounty-label-name`: Name of the label used in issues to declare that an issue is a bounty
  - `bounty-project-board/post-approved-bounties-to-slack-room`: Name of the Slack room where to cross-post approved bounties 

- Automated tests settings:
  - `automated-tests/repo-full-name`: Full name of the repo to watch in project cards in order to automatically run automated tests CI job (e.g. `status-im/status-react`)
  - `automated-tests/job-full-name`: Full name of the CI job to run automated tests (e.g. `end-to-end-tests/status-app-end-to-end-tests`)

## Restart the bot

You may want to get comfortable with `heroku logs` and `heroku restart` if
you're having issues.
