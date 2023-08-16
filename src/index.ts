import crypto from 'crypto'

import axios from 'axios'
import bodyParser from 'body-parser'
import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'

import { Bot, createBot } from './bot'
import { ChannelbackRequest, ExternalResource, Metadata } from './zendesk'

dotenv.config()

if (!process.env.SITE || !process.env.SECRET || !process.env.PUSH) {
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

const rawBodySaver = (req: any, res: any, buf: Buffer, encoding: any) => (req.rawBody = buf)

app.use(bodyParser.json({ verify: rawBodySaver }))
app.use(bodyParser.urlencoded({ extended: true }))

app.all('/attachment/(*)', async (req, res) => {
    if (typeof req.query.token !== 'string') {
        res.status(403).send('Missing token')
        return
    }

    try {
        const token = jwt.verify(req.query.token, process.env.SECRET!)
        if (token !== req.params[0]) throw new Error('Mismatch')

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
        channelback_files: !!process.env.PUSH,
        push_client_id: process.env.PUSH,
        urls: {
            admin_ui: `${site}/admin`,
            pull_url: `${site}/pull`,
            channelback_url: `${site}/channelback`,
            clickthrough_url: `${site}/clickthrough`,
            event_callback_url: `${site}/event_callback`,
        },
    })
})

/**
 * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/administrative_interface/
 */
app.post('/admin', (req, res) => {
    if (
        typeof req.body !== 'object' ||
        typeof req.body.return_url !== 'string' ||
        (req.body.name && typeof req.body.metadata !== 'string')
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

            push: {
                subdomain: req.body.subdomain,
                instance_push_id: req.body.instance_push_id,
                zendesk_access_token: req.body.zendesk_access_token,
            },
        })
    } else {
        res.render('admin.ejs', {
            name: '',
            metadata: {},
            return_url: req.body.return_url,

            push: {
                subdomain: req.body.subdomain,
                instance_push_id: req.body.instance_push_id,
                zendesk_access_token: req.body.zendesk_access_token,
            },
        })
    }
})

// NOTE(auguste): We need to do this as, as far as I'm aware, there's no other way
// to verify Zendesk message provenance for the /pull and /channelback routes
async function isTokenValid(metadata: Metadata): Promise<boolean> {
    try {
        await axios.post(
            `https://${metadata.subdomain}.zendesk.com/api/v2/any_channel/validate_token`,
            {
                instance_push_id: metadata.instance_push_id,
            },
            {
                headers: {
                    Authorization: `Bearer ${metadata.zendesk_access_token}`,
                },
            }
        )
        return true
    } catch {
        return false
    }
}

/**
 * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/pull_endpoint/
 */
app.all('/pull', async (req, res) => {
    if (typeof req.body !== 'object' || typeof req.body.metadata !== 'string') {
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
        typeof metadata !== 'object' ||
        typeof metadata.uuid !== 'string' ||
        typeof metadata.token !== 'string' ||
        typeof metadata.channel !== 'string'
    ) {
        res.status(400).send('Bad request')
        return
    }

    if (!(await isTokenValid(metadata))) {
        res.status(403).send('Forbidden')
        return
    }

    if (bots.has(metadata.uuid) && bots.get(metadata.uuid)!.params.metadata.token !== metadata.token) {
        bots.get(metadata.uuid)?.destroy()
        bots.delete(metadata.uuid)
    }

    if (!bots.has(metadata.uuid)) {
        if (!botExternalResourceQueue.has(metadata.uuid)) {
            botExternalResourceQueue.set(metadata.uuid, [])
        }

        bots.set(
            metadata.uuid,
            await createBot({
                metadata,
                async pushExternalResource(metadata: Metadata, resource: ExternalResource): Promise<void> {
                    if (process.env.PUSH && metadata.zendesk_access_token) {
                        axios.post(
                            `https://${metadata.subdomain}.zendesk.com/api/v2/any_channel/push`,
                            {
                                instance_push_id: metadata.instance_push_id,
                                external_resources: [resource],
                            },
                            {
                                headers: {
                                    Authorization: `Bearer ${metadata.zendesk_access_token}`,
                                },
                            }
                        )
                    } else {
                        botExternalResourceQueue.get(metadata.uuid)!.push(resource)
                    }
                },
            })
        )
        console.log(`Configured bot that handles channel #${metadata.channel}`)
    } else {
        bots.get(metadata.uuid)!.params.metadata = metadata
        await bots.get(metadata.uuid)!.onUpdateParams()
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
        typeof req.body !== 'object' ||
        typeof req.body.message !== 'string' ||
        typeof req.body.thread_id !== 'string' ||
        typeof req.body.metadata !== 'string'
    ) {
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

    if (!(await isTokenValid(metadata))) {
        res.status(403).send('Forbidden')
        return
    }

    const bot = bots.get(metadata.uuid)
    if (!bot) {
        res.status(500).send('Internal server error')
        return
    }

    try {
        const externalId = await bot.channelback(req.body as ChannelbackRequest)
        if (!externalId) {
            res.status(500).send('Internal server error')
            return
        }

        res.send({
            external_id: externalId,
            allow_channelback: true,
        })
    } catch {
        res.status(500).send('Internal server error')
        return
    }
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
        try {
            const location = await value.clickthrough({
                external_id: req.query.external_id,
            })

            if (location) {
                res.redirect(location)
                return
            }
        } catch {}
    }

    res.status(500).send('Internal server error')
})

app.post('/event_callback', (req, res) => {
    res.status(200).send()
})

app.post('/webhook', async (req, res) => {
    const signature = req.headers['x-zendesk-webhook-signature']
    const timestamp = req.headers['x-zendesk-webhook-signature-timestamp']

    if (
        !(req as any).rawBody ||
        typeof signature !== 'string' ||
        typeof timestamp !== 'string' ||
        typeof req.body !== 'object' ||
        typeof req.body.tags !== 'string' ||
        typeof req.body.status !== 'string'
    ) {
        res.status(200).send()
        return
    }

    const ourSignature = crypto
        .createHmac('sha256', process.env.SECRET!)
        .update(`${timestamp}${(req as any).rawBody.toString('utf-8')}`)
        .digest('base64')

    if (signature !== ourSignature) {
        res.status(200).send()
        return
    }

    const threadTag = req.body.tags.split(' ').find((_: any) => _.startsWith('do-not-remove-discord-'))
    if (!threadTag) {
        res.status(200).send()
        return
    }

    for (const value of bots.values()) {
        try {
            await value.statusChange(threadTag.replace('do-not-remove-discord-', ''), req.body.status)
        } catch {}
    }

    res.status(200).send()
})

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080
app.listen(port, () => {
    console.log(`Server listening on port ${port}`)
})
