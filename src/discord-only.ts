import dotenv from 'dotenv'

import { createBot } from './bot'

dotenv.config()

createBot({
    metadata: {
        uuid: 'discord-only',
        channel: process.env.DISCORD_ONLY_CHANNEL!,
        token: process.env.DISCORD_ONLY_TOKEN!,
    },

    async pushExternalResource(metadata, resource) {},
})
