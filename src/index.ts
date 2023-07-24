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

const channelToTicket = new Map<string, number>()

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

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages],
})

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

    await interaction.setAppliedTags([...interaction.appliedTags, tags.get('New')!])

    const starter = await interaction.fetchStarterMessage()

    if (starter) {
        const response = (await zendeskClient.tickets.create({
            ticket: {
                subject: interaction.name,
                comment: {
                    body: `**${starter.author.username}** ([original message](${starter.url}))\n\n${starter?.content}`,
                    public: true,
                },
                status: 'new',
            },
        })) as any as zendesk.Tickets.ResponseModel

        await interaction.send({
            content: `A ticket (ID \`${response.id}\`) has been created for your issue. A support agent will get back to you soon!`,
        })

        channelToTicket.set(starter.channelId, response.id)
    } else {
        console.error('no starter!')
    }
})

async function getTicketFromChannel(channelId: string): Promise<number | null> {
    if (channelToTicket.has(channelId)) {
        return channelToTicket.get(channelId)!
    }

    const channel = client.channels.resolve(channelId)
    if (!channel || !channel.isTextBased() || !channel.isThread()) {
        return null
    }

    const messages = await channel.messages.fetch({
        limit: 10,
    })

    const ticketMessage = messages.find(
        message => message.author.id === client.user!.id && message.content.includes('ticket')
    )
    if (!ticketMessage) {
        return null
    }

    const ticket = parseInt(
        ticketMessage.content.slice(ticketMessage.content.indexOf('`') + 1, ticketMessage.content.lastIndexOf('`'))
    )
    channelToTicket.set(channelId, ticket)

    return ticket
}

client.on('messageCreate', async interaction => {
    console.log('msg', interaction.content, interaction.thread)

    if (!interaction.channel.isThread() || interaction.channel.parentId !== SUPPORT_CHANNEL_ID) {
        return
    }

    const ticketId = await getTicketFromChannel(interaction.channelId)
    if (!ticketId) {
        return
    }

    await zendeskClient.tickets.update(ticketId, {
        ticket: {
            comment: {
                public: true,
                body: `**${interaction.author.username}** ([original message](${interaction.url}))\n\n${interaction.content}`,
            },
        },
    })
})

client.login(process.env.DISCORD_TOKEN)
