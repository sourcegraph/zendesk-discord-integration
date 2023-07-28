import path from 'path'

import { QdrantClient } from '@qdrant/js-client-rest'
import axios from 'axios'
import {
    ActionRowBuilder,
    AnyThreadChannel,
    AttachmentBuilder,
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
import { Configuration, OpenAIApi } from 'openai'

import { ChannelbackRequest, ClickthroughRequest, ExternalResource, Metadata } from './zendesk'

dotenv.config()

const qdrantClient: QdrantClient | null = process.env.QDRANT_URL
    ? new QdrantClient({ url: process.env.QDRANT_URL })
    : null

const openaiClient: OpenAIApi | null = process.env.OPENAI_KEY
    ? new OpenAIApi(
          new Configuration({
              apiKey: process.env.OPENAI_KEY,
          })
      )
    : null

interface BotParams {
    metadata: Metadata
    /**
     * Either immediately pushes or queues up external resources to be sent to Zendesk
     */
    pushExternalResource: (metadata: Metadata, resource: ExternalResource) => Promise<void>
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

    destroy(): void
}

export async function createBot(params: BotParams): Promise<Bot> {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages],
    })

    if (qdrantClient) {
        const collectionNames = (await qdrantClient.getCollections()).collections.map(collection => collection.name)
        if (!collectionNames.includes(`${params.metadata.uuid}-${params.metadata.channel}`)) {
            qdrantClient.createCollection(`${params.metadata.uuid}-${params.metadata.channel}`, {
                vectors: {
                    size: 1536,
                    distance: 'Cosine',
                },
            })
        }
    }

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
        if (interaction.parentId !== params.metadata.channel) {
            return
        }

        await interaction.send({
            content: `Hey <@${interaction.ownerId}>, thanks for reaching out! The resources below might be useful to you.`,
            components: [createActionButtonRow('close')],
        })

        const starter = await interaction.fetchStarterMessage()

        if (starter) {
            await params.pushExternalResource(params.metadata, {
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

            if (qdrantClient && openaiClient) {
                const response = await openaiClient.createEmbedding({
                    model: 'text-embedding-ada-002',
                    input: `# ${interaction.name}
                
                ${starter.content}`,
                })

                const results = await qdrantClient?.search(`${params.metadata.uuid}-${params.metadata.channel}`, {
                    vector: response.data.data[0].embedding,
                    limit: 5,
                })

                const threads = await Promise.all(
                    results.map(result => interaction.parent!.threads.resolve(result.payload!.discord_id as string))
                )
                await interaction.send({
                    content: 'These other threads might be useful to you:',
                    components: threads
                        .filter(_ => _ !== null)
                        .map((thread, index) =>
                            new ActionRowBuilder<ButtonBuilder>().addComponents(
                                new ButtonBuilder()
                                    .setLabel(`${thread!.name} (${(results[index].score * 100).toFixed(2)}% match)`)
                                    .setStyle(ButtonStyle.Link)
                                    .setURL(thread!.url)
                            )
                        ),
                })

                qdrantClient.upsert(`${params.metadata.uuid}-${params.metadata.channel}`, {
                    wait: false,
                    points: [
                        {
                            id: crypto.randomUUID(),
                            vector: response.data.data[0].embedding,
                            payload: {
                                discord_id: interaction.id,
                            },
                        },
                    ],
                })
            }
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
            interaction.channel.parentId !== params.metadata.channel ||
            // Messages that are thread starters but not label thread starters for some reason
            (await interaction.channel.fetchStarterMessage())?.id === interaction.id
        ) {
            return
        }

        await params.pushExternalResource(params.metadata, {
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

    client.login(params.metadata.token)

    return {
        params,

        async channelback(request: ChannelbackRequest): Promise<string | null> {
            const channel = await client.channels.fetch(params.metadata.channel)
            if (channel?.type !== ChannelType.GuildForum) {
                return null
            }

            const thread = await channel.threads.fetch(request.thread_id)
            if (!thread) {
                return null
            }

            const attachmentData = await Promise.all(
                (request.file_urls || []).map(url =>
                    axios.get(url, {
                        responseType: 'arraybuffer',
                        headers: {
                            Authorization: `Bearer ${params.metadata.zendesk_access_token}`,
                        },
                    })
                )
            )

            const message = await thread.send({
                content: request.message,
                files: (request.file_urls || []).map(
                    (url, index) =>
                        new AttachmentBuilder(attachmentData[index].data, {
                            name: path.basename(url),
                        })
                ),
            })

            return `${thread.id}-${message.id}`
        },

        async clickthrough(request: ClickthroughRequest): Promise<string | null> {
            const parts = request.external_id.split('-')

            const channel = await client.channels.fetch(params.metadata.channel)
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

        destroy() {
            client.destroy()
        },
    }
}
