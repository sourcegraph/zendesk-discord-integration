import bodyParser from 'body-parser'
import {
    ActionRowBuilder,
    AnyThreadChannel,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    ComponentType,
    GatewayIntentBits,
    InteractionType,
    MessageType,
} from 'discord.js'
import dotenv from 'dotenv'
import express from 'express'

import { ChannelbackRequest, ExternalResource } from './zendesk'

dotenv.config()

if (
    !process.env.SITE ||
    !process.env.DISCORD_TOKEN ||
    !process.env.ZENDESK_EMAIL ||
    !process.env.ZENDESK_TOKEN ||
    !process.env.ZENDESK_REMOTE ||
    !process.env.SUPPORT_CHANNEL_ID
) {
    console.log('bad config')
    process.exit(1)
}

const site = process.env.SITE!

const app = express()

let externalResourceQueue: ExternalResource[] = []

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

/**
 * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/integration_manifest/
 */
app.get('/manifest.json', (req, res) => {
    console.info('Manifest touched!')

    res.send({
        name: 'Zendesk Discord Integration',
        id: site,
        author: 'Auguste Rame',
        version: 'v0.0.1',
        channelback_files: true,
        urls: {
            admin_ui: `${site}/admin`,
            pull_url: `${site}/pull`,
            channelback_url: `${site}/channelback`,
            clickthrough_url: `${site}/clickthrough`,
        },
    })
})

/**
 * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/administrative_interface/
 */
app.post('/admin', (req, res) => {
    // xss lol; not an actual issue in this context but still

    // this hack exists because you need an account to associate with a pull request
    // in the future we could properly configure discord interaction capturing with this
    // but that's overkill for now

    res.send(
        `<form action="${req.body.return_url}" method="post"><input name="name" value="testacct1"><input name="metadata" value="none"><input name="state" value="none"><input type="submit"></form>`
    )

    console.error(req.body)
})

/**
 * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/pull_endpoint/
 */
app.all('/pull', (req, res) => {
    res.send({
        external_resources: externalResourceQueue.splice(0),
    })
})

/**
 * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/channelback/
 */
app.post('/channelback', async (req, res) => {
    if (typeof req.body.message !== 'string' || typeof req.body.thread_id !== 'string') {
        res.status(400).send('Bad request')
        return
    }

    const request = req.body as ChannelbackRequest

    const channel = await client.channels.fetch(SUPPORT_CHANNEL_ID)
    if (channel?.type !== ChannelType.GuildForum) {
        res.status(500).send('Internal server error')
        return
    }

    const thread = await channel.threads.fetch(request.thread_id)
    if (!thread) {
        res.status(500).send('Internal server error')
        return
    }

    const message = await thread.send({
        content: request.message,
        // files: request.file_urls,
    })

    res.send({
        external_id: `${thread.id}-${message.id}`,
        allow_channelback: true,
    })
})

/**
 * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/clickthrough_endpoint/
 */
app.get('/clickthrough', async (req, res) => {
    if (typeof req.query.external_id !== 'string') {
        res.status(400).send('Bad request')
        return
    }

    const parts = req.query.external_id.split('-')

    const channel = await client.channels.fetch(SUPPORT_CHANNEL_ID)
    if (channel?.type !== ChannelType.GuildForum) {
        res.status(500).send('Internal server error')
        return
    }

    if (parts.length === 1) {
        const thread = await channel.threads.fetch(parts[0])
        if (!thread?.url) {
            res.status(500).send('Internal server error')
            return
        }

        res.redirect(thread.url)
    } else {
        const thread = await channel.threads.fetch(parts[0])
        if (!thread) {
            res.status(500).send('Internal server error')
            return
        }

        const message = await thread.messages.fetch(parts[1])
        if (!message.url) {
            res.status(500).send('Internal server error')
            return
        }

        res.redirect(message.url)
    }
})

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080
app.listen(port, () => {
    console.log(`Server listening on port ${port}`)
})

const SUPPORT_CHANNEL_ID = process.env.SUPPORT_CHANNEL_ID

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages],
})

client.on('ready', async () => {
    console.log(`Logged in as ${client.user!.tag}!`)
})

client.on('interactionCreate', async interaction => {
    if (
        interaction.type === InteractionType.MessageComponent &&
        interaction.componentType === ComponentType.Button &&
        interaction.customId === 'close'
    ) {
        const thread = interaction.message.channel as AnyThreadChannel

        await interaction.update({
            components: [createActionButtonRow('reopen')],
        })
        await thread.setArchived(true)
    }

    if (
        interaction.type === InteractionType.MessageComponent &&
        interaction.componentType === ComponentType.Button &&
        interaction.customId === 'reopen'
    ) {
        const thread = interaction.message.channel as AnyThreadChannel

        await thread.setArchived(false)
        await interaction.update({
            components: [createActionButtonRow('close')],
        })
    }
})

function createActionButtonRow(button: 'close' | 'reopen'): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>()

    row.addComponents(
        button === 'close'
            ? new ButtonBuilder().setLabel('Close').setCustomId('close').setStyle(ButtonStyle.Danger).setEmoji('🔒')
            : new ButtonBuilder().setLabel('Reopen').setCustomId('reopen').setStyle(ButtonStyle.Primary).setEmoji('🔓'),
        new ButtonBuilder()
            .setLabel('Docs')
            .setStyle(ButtonStyle.Link)
            .setEmoji('📚')
            .setURL('https://docs.sourcegraph.com/'),
        new ButtonBuilder()
            .setLabel('YouTube')
            .setStyle(ButtonStyle.Link)
            .setEmoji('📺')
            .setURL('https://www.youtube.com/c/sourcegraph'),
        new ButtonBuilder()
            .setLabel('Status')
            .setStyle(ButtonStyle.Link)
            .setEmoji('🧭')
            .setURL('https://sourcegraphstatus.com/')
    )

    return row
}

client.on('threadCreate', async interaction => {
    if (interaction.parentId !== SUPPORT_CHANNEL_ID) {
        return
    }

    await interaction.send({
        content: `Hey <@${interaction.ownerId}>, thanks for reaching out! The resources below might be useful to you.`,
        components: [createActionButtonRow('close')],
    })

    const starter = await interaction.fetchStarterMessage()

    if (starter) {
        externalResourceQueue.push({
            external_id: interaction.id,
            author: {
                external_id: starter.author.id,
                name: starter.author.username,
                image_url: starter.author.displayAvatarURL({ size: 512 }),
                locale: 'en',
                fields: [],
            },
            created_at: new Date(interaction.createdTimestamp ?? Date.now()).toISOString(),
            message: starter.content,
            internal_note: false,
            allow_channelback: true,
            fields: [
                {
                    id: 'subject',
                    value: interaction.name,
                },
            ],
        })
    } else {
        console.error('no starter!')
    }
})

client.on('messageCreate', async interaction => {
    if (
        // Messages by our bot user
        interaction.author.id === client.user!.id ||
        // Messages not in a thread
        !interaction.channel.isThread() ||
        // Messages that are thread starters
        interaction.type === MessageType.ThreadStarterMessage ||
        // Messages not in the forum we control
        interaction.channel.parentId !== SUPPORT_CHANNEL_ID ||
        // Messages that are thread starters but not label thread starters for some reason
        (await interaction.channel.fetchStarterMessage())?.id === interaction.id
    ) {
        return
    }

    externalResourceQueue.push({
        external_id: `${interaction.channelId}-${interaction.id}`,
        thread_id: interaction.channelId,
        author: {
            external_id: interaction.author.id,
            name: interaction.author.username,
            image_url: interaction.author.displayAvatarURL({ size: 512 }),
            locale: 'en',
            fields: [],
        },
        created_at: new Date(interaction.createdTimestamp).toISOString(),
        message: interaction.content,
        internal_note: false,
        allow_channelback: true,
    })
})

client.login(process.env.DISCORD_TOKEN)
