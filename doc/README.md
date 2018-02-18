# Status Bot Documentation

### Configuration

All bots should have a global identifier (string). Configuration for each Bot and repository pairing will be stored in `bot-config.yml`.

#### Recipe — Getting configuration in bots:

```js
TODO
```

#### Recipe — Disabling a bot for a specific repository:

Edit the configuration for the bot in [`bot-config.yml`](/bot-config.yml):

```yml
notify-reviewers-via-slack:
  globallyEnabled: true
  repoConfig:
    status-im/status-react:
      # disables bot for status-im/status-react
      disabled: true
```

#### Recipe — Disabling a bot globally:

Edit the configuration for the bot in [`bot-config.yml`](/bot-config.yml):

```yml
notify-reviewers-via-slack:
  globallyEnabled: false
```