import {
    ActionRowBuilder,
    AnyThreadChannel,
    ButtonBuilder,
    ButtonStyle,
    Client,
    ComponentType,
    ForumChannel,
    GatewayIntentBits,
    InteractionType,
} from 'discord.js'
import dotenv from 'dotenv'
import zendesk from 'node-zendesk'

dotenv.config()

if (
    !process.env.DISCORD_TOKEN ||
    !process.env.ZENDESK_USERNAME ||
    !process.env.ZENDESK_TOKEN ||
    !process.env.ZENDESK_REMOTE ||
    !process.env.SUPPORT_CHANNEL_ID
) {
    console.log('bad config')
    process.exit(1)
}

const zendeskClient = zendesk.createClient({
    // this would be a user's email address
    username: process.env.ZENDESK_USERNAME,
    token: process.env.ZENDESK_TOKEN,
    // this would be https://sourcegraph.zendesk.com/api/v2
    remoteUri: process.env.ZENDESK_REMOTE,
    oauth: false,
})

const SUPPORT_CHANNEL_ID = process.env.SUPPORT_CHANNEL_ID

let tags = new Map<string, string>()

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.on('ready', () => {
    console.log(`Logged in as ${client.user!.tag}!`)
    const supportForum = client.channels.resolve(SUPPORT_CHANNEL_ID) as ForumChannel
    for (const tag of supportForum.availableTags) {
        tags.set(tag.name, tag.id)
    }
})

client.on('interactionCreate', async interaction => {
    if (
        interaction.type === InteractionType.MessageComponent &&
        interaction.componentType === ComponentType.Button &&
        interaction.customId === 'close'
    ) {
        const thread = interaction.message.channel as AnyThreadChannel
        thread.setArchived(true)
        thread.setLocked(true)
    }
})

client.on('threadCreate', async interaction => {
    if (interaction.parentId !== SUPPORT_CHANNEL_ID) {
        return
    }

    const row = new ActionRowBuilder<ButtonBuilder>()

    row.addComponents(
        new ButtonBuilder().setLabel('Close').setCustomId('close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
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

    await interaction.send({
        content: `Hey <@${interaction.ownerId}>, thanks for reaching out!`,
        components: [row],
    })

    await interaction.setAppliedTags([...interaction.appliedTags, tags.get('New')!])

    const starter = await interaction.fetchStarterMessage()

    if (starter) {
        zendeskClient.tickets.create({
            ticket: {
                subject: interaction.name,
                comment: {
                    body: starter?.content,
                    url: starter.url,
                    public: true,
                },
                status: 'new',
            },
        })
    } else {
        console.error('no starter!')
    }
})

client.login(process.env.DISCORD_TOKEN)
