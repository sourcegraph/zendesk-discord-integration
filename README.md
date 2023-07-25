# Zendesk Discord Integration

This repository provides a Discord bot that syncs support forum posts with Zendesk tickets.

**Still WIP; DO NOT DEPLOY THIS PLEASE**

## Getting Started

You'll need to set the following environment variables:

### `DISCORD_TOKEN`

Go to [the Discord developers page](https://discord.com/developers/applications) and create a new application. Get the token for your bot user under the `Bot` tab.

Note: Under `Privileged Gateway Intents`, ensure `Server Members Intent` and `Message Content Intent` are enabled.

### `SUPPORT_CHANNEL_ID`

Go to your Discord settings, then `Advanced`, and enable `Developer Mode`. Find your forum channel of choice, right click, and click `Copy Channel ID`.

### `ZENDESK_EMAIL`

This is the email of a valid Zendesk account. It'll act as the sender of all Discord messages within Zendesk.

### `ZENDESK_TOKEN`

You can obtain a Zendesk token via the Zendesk `Admin Center` under `Apps and integrations > Zendesk API`. 

### `ZENDESK_REMOTE`

This is the Zendesk API route. In our case, it'll always be `https://sourcegraph.zendesk.com/api/v2`.
