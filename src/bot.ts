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

import { ChannelbackRequest, ClickthroughRequest, ExternalResource } from './zendesk'

interface BotParams {
    token: string
    supportChannelId: string
    /**
     * Either immediately pushes or queues up external resources to be sent to Zendesk
     */
    pushExternalResource: (resource: ExternalResource) => Promise<void>
}

export interface Bot {
    params: BotParams

    /**
     * Handles a ChannelbackRequest, returning the new channeled message's external id
     */
    channelback(request: ChannelbackRequest): Promise<string | null>

    /**
     * Handles a ClickthroughRequest, returning the new clickthrough URL to be redirect to
     */
    clickthrough(request: ClickthroughRequest): Promise<string | null>
}

export function createBot(params: BotParams): Bot {
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
                : new ButtonBuilder()
                      .setLabel('Reopen')
                      .setCustomId('reopen')
                      .setStyle(ButtonStyle.Primary)
                      .setEmoji('🔓'),
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
        if (interaction.parentId !== params.supportChannelId) {
            return
        }

        await interaction.send({
            content: `Hey <@${interaction.ownerId}>, thanks for reaching out! The resources below might be useful to you.`,
            components: [createActionButtonRow('close')],
        })

        const starter = await interaction.fetchStarterMessage()

        if (starter) {
            await params.pushExternalResource({
                external_id: interaction.id,
                author: {
                    external_id: starter.author.id,
                    name: starter.author.username,
                    image_url: starter.author.displayAvatarURL({ size: 512 }),
                    locale: 'en',
                    fields: [],
                },
                created_at: new Date(interaction.createdTimestamp ?? Date.now()).toISOString(),
                message: starter.content || '*No message content*',
                internal_note: false,
                allow_channelback: true,
                fields: [
                    {
                        id: 'subject',
                        value: interaction.name,
                    },
                ],
                file_urls: starter.attachments.map(
                    attachment => `${process.env.SITE!}/attachment/${encodeURIComponent(attachment.url)}`
                ),
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
            interaction.channel.parentId !== params.supportChannelId ||
            // Messages that are thread starters but not label thread starters for some reason
            (await interaction.channel.fetchStarterMessage())?.id === interaction.id
        ) {
            return
        }

        await params.pushExternalResource({
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
            message: interaction.content || '*No message content*',
            internal_note: false,
            allow_channelback: true,
            file_urls: interaction.attachments.map(
                attachment => `${process.env.SITE!}/attachment/${encodeURIComponent(attachment.url)}`
            ),
        })
    })

    client.login(params.token)

    return {
        params,

        async channelback(request: ChannelbackRequest): Promise<string | null> {
            const channel = await client.channels.fetch(params.supportChannelId)
            if (channel?.type !== ChannelType.GuildForum) {
                return null
            }

            const thread = await channel.threads.fetch(request.thread_id)
            if (!thread) {
                return null
            }

            const message = await thread.send({
                content: request.message,
                files: request.file_urls,
            })

            return `${thread.id}-${message.id}`
        },

        async clickthrough(request: ClickthroughRequest): Promise<string | null> {
            const parts = request.external_id.split('-')

            const channel = await client.channels.fetch(params.supportChannelId)
            if (channel?.type !== ChannelType.GuildForum) {
                return null
            }

            if (parts.length === 1) {
                const thread = await channel.threads.fetch(parts[0])
                if (!thread?.url) {
                    return null
                }

                return thread.url
            } else {
                const thread = await channel.threads.fetch(parts[0])
                if (!thread) {
                    return null
                }

                const message = await thread.messages.fetch(parts[1])
                if (!message.url) {
                    return null
                }

                return message.url
            }
        },
    }
}
