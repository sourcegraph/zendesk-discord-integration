import axios from 'axios'
import bodyParser from 'body-parser'
import dotenv from 'dotenv'
import express from 'express'

import { Bot, createBot } from './bot'
import { ChannelbackRequest, ExternalResource, Metadata } from './zendesk'

dotenv.config()

if (!process.env.SITE) {
    console.log('bad config')
    process.exit(1)
}

const site = process.env.SITE!

const app = express()

/**
 * Map from randomly generated id to bot
 */
let bots = new Map<string, Bot>()
let botExternalResourceQueue = new Map<string, ExternalResource[]>()

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

app.all('/attachment/(*)', async (req, res) => {
    try {
        const { data } = await axios.get(req.params[0], {
            responseType: 'stream',
            timeout: 10_000,
        })
        data.pipe(res)
    } catch {
        res.status(500).send('Internal server error')
        return
    }
})

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
    if (
        typeof req.body.return_url !== 'string' ||
        (typeof req.body.name && (typeof req.body.name !== 'string' || typeof req.body.metadata !== 'string'))
    ) {
        res.status(400).send('Bad request')
        return
    }

    if (req.body.name) {
        let metadata: Metadata
        try {
            metadata = JSON.parse(req.body.metadata)
        } catch {
            res.status(400).send('Bad request')
            return
        }

        res.render('admin.ejs', {
            name: req.body.name,
            metadata,
            return_url: req.body.return_url,
        })
    } else {
        res.render('admin.ejs', {
            name: '',
            metadata: {},
            return_url: req.body.return_url,
        })
    }
})

/**
 * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/pull_endpoint/
 */
app.all('/pull', (req, res) => {
    if (typeof req.body.metadata !== 'string') {
        res.status(400).send('Bad request')
        return
    }

    let metadata: Metadata
    try {
        metadata = JSON.parse(req.body.metadata)
    } catch {
        res.status(400).send('Bad request')
        return
    }

    if (
        typeof metadata.uuid !== 'string' ||
        typeof metadata.token !== 'string' ||
        typeof metadata.channel !== 'string'
    ) {
        res.status(400).send('Bad request')
        return
    }

    if (!bots.has(metadata.uuid)) {
        botExternalResourceQueue.set(metadata.uuid, [])
        bots.set(
            metadata.uuid,
            createBot({
                token: metadata.token,
                supportChannelId: metadata.channel,
                async pushExternalResource(resource: ExternalResource): Promise<void> {
                    botExternalResourceQueue.get(metadata.uuid)!.push(resource)
                },
            })
        )
        console.log(`Configured bot that handles channel #${metadata.channel}`)
    } else {
        bots.get(metadata.uuid)!.params.token = metadata.token
        bots.get(metadata.uuid)!.params.supportChannelId = metadata.channel
    }

    res.send({
        external_resources: botExternalResourceQueue.get(metadata.uuid)?.splice(0) ?? [],
    })
})

/**
 * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/channelback/
 */
app.post('/channelback', async (req, res) => {
    if (
        typeof req.body.message !== 'string' ||
        typeof req.body.thread_id !== 'string' ||
        typeof req.body.metadata !== 'string' ||
        // Check metadata characteristics
        typeof req.body.metadata.uuid !== 'string' ||
        typeof req.body.metadata.token !== 'string' ||
        typeof req.body.metadata.channel !== 'string'
    ) {
        res.status(400).send('Bad request')
        return
    }

    const bot = bots.get(req.body.metadata.uuid)
    if (!bot) {
        res.status(500).send('Internal server error')
        return
    }

    const externalId = await bot.channelback(req.body as ChannelbackRequest)

    if (!externalId) {
        res.status(500).send('Internal server error')
        return
    }

    res.send({
        external_id: externalId,
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

    // We don't use a Promise.all here to avoid potential rate-limiting
    for (const value of bots.values()) {
        const location = await value.clickthrough({
            external_id: req.query.external_id,
        })

        if (location) {
            res.redirect(location)
            return
        }
    }

    res.status(500).send('Internal server error')
})

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080
app.listen(port, () => {
    console.log(`Server listening on port ${port}`)
})
