# Zendesk Discord Integration

This repository provides a Discord bot that syncs support forum posts with Zendesk tickets.

Please see the instructions below to get started.

## Environment Variables

You'll need to set the following environment variables, either in your command line or in a `.env` file:

### `SITE`

The site on which you'll be hosting the Zendesk channel server and Discord bot (e.g. `SITE=https://somesubdomain.sourcegraph.com`).

### `PUSH` (optional but recommended)

The unique identifier of an OAuth client created under `Apps and integrations > APIs > Zendesk API > OAuth Clients`. Note that this is not a user authenticated interaction, so no redirect URL is required when creating this OAuth client.

Without this environment variable, messages will only be pulled from Discord approximately every two minutes.

(Ignore this if this is a first setup) Note that if you enable this *after* having created some integration accounts, you'll have to edit and save them for this to kick in.

### `QDRANT_URL` (optional)

URL to a Qdrant database.

### `OPENAI_KEY` (optional)

OpenAI key for embeddings.

## Packaging and Uploading the App

### Automatically

Set `DEPLOY_SUBDOMAIN` to a Zendesk subdomain, for example `sourcegraph`, and `DEPLOY_AUTHORIZATION` set to [a valid Zendesk Authorization header value](https://developer.zendesk.com/api-reference/introduction/security-and-auth/#api-token).

Then you can run `pnpm run zendesk:deploy` however many times you like to redeploy the app from scratch. Do this when modifying `requirements.json` or if you want manifest changes to percolate faster.

### Manually

Run `pnpm run zendesk:package` (with all your desired environment variables set) and upload the `zendesk-installer.zip` to `Apps and integrations > Zendesk Support apps > Private Apps`.

This application lets Zendesk know about our Discord to Zendesk bridge server, specified in `SITE`.

## Channel App Integration

Now, go to `Apps and integrations > Channel apps > [name of the app you registered] > Accounts > Add Account`

### Discord Token

Go to [the Discord developers page](https://discord.com/developers/applications) and create a new application. Get the token for your bot user under the `Bot` tab.

Note: Under `Privileged Gateway Intents`, ensure `Server Members Intent` and `Message Content Intent` are enabled.

### Support Channel ID

Go to your Discord settings, then `Advanced`, and enable `Developer Mode`. Find your forum channel of choice, right click, and click `Copy Channel ID`.

## Testing

```bash
docker pull qdrant/qdrant
docker run -p 6333:6333 \
    -v ~/.drant-data:/qdrant/storage \
    qdrant/qdrant

# (Re)deploy Zendesk app
pnpm run zendesk:deploy
```

## Prior Art / References

- https://github.com/nexmo-saleseng/zendesk-nexmo-channel-integration
