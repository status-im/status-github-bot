# statusbot

statusbot is a chat bot built on the [Probot][probot] framework. There's a wiki available [here][wiki].

This README is intended to help get you started. Definitely update and improve
to talk about your own instance, how to use and deploy, what functionality is
available, etc!

[probot]: https://probot.github.io/docs/deployment/
[wiki]: https://wiki.status.im/GitHub_bot

## What does the bot do?

Right now the bot has two sets of capabilities:

- Doing background management in GitHub:
  - Assign new PRs to the `Pipeline for QA` project board (`REVIEW` column).
  - Move existing PRs to the correct `Pipeline for QA` project board column (`REVIEW`/`IN TEST`) depending on whether or not the required conditions are met (is mergeable, at least two reviewers have approved and there is no request for changes).
  - Assign issues that are labeled `bounty-awaiting-approval` to the `Status SOB Swarm` project board (`bounty-awaiting-approval` column).
  - Welcome users who post their first PR in a project.
  - Checks if all commits are GPG-signed and sets the PR status accordingly.
  - Unfurls links on Issues and Pull Request discussions.
  - Disallows merging of PRs containing WIP in the title.
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
        - Organization projects - **Read-only**
            - [x] Check the box for **Project for organization projects** events
        - Single File - **Read-only**
            - Path: `.github/github-bot.yml`
    1. Generate a private key pass and save it.
1. Installing the bot service:
    1. Deploy the bot to the cloud.
    1. Set the `APP_ID` environment variable to value reported when the GitHub App was created.
    1. Set the `WEBHOOK_SECRET` environment variable to the value configured in the GitHub App.
    1. Set the `PRIVATE_KEY` environment variable to the contents of the `.pem` file.
    1. Set the `SLACK_BOT_TOKEN` environment variable to the value reported for the bot in [Slack](https://status-im.slack.com/apps/).
1. Install the GitHub App in an account:
    1. Select the repositories where the bot should work (e.g. `status-react`).

## Restart the bot

You may want to get comfortable with `heroku logs` and `heroku restart` if
you're having issues.
