// Packages the app installer for Zendesk

import { createWriteStream } from 'fs'

import dotenv from 'dotenv'
import JSZip from 'jszip'

export function createZipStream(site: string, secret: string) {
    const zip = new JSZip()

    zip.file(
        'manifest.json',
        JSON.stringify({
            name: 'Zendesk Discord Integration Installer',
            author: {
                name: 'Auguste Rame',
                email: 'auguste.rame@sourcegraph.com',
            },
            defaultLocale: 'en',
            private: true,
            requirementsOnly: true,
            singleInstall: true,
            version: '0.0.1',
        })
    )

    zip.file(
        'requirements.json',
        JSON.stringify({
            channel_integrations: {
                [site]: {
                    manifest_url: `${site}/manifest.json`,
                },
            },
            webhooks: {
                status_change_endpoint: {
                    endpoint: `${site}/webhook`,
                    http_method: 'POST',
                    name: 'Status Changed Endpoint',
                    request_format: 'json',
                    status: 'active',
                    subscriptions: ['conditional_ticket_events'],
                    signing_secret: {
                        algorithm: 'SHA256',
                        secret,
                    },
                },
            },
            triggers: {
                notify_ticket_status_changed: {
                    title: 'Notify ticket status changed',
                    all: [
                        {
                            field: 'status',
                            operator: 'changed',
                        },
                    ],
                    actions: [
                        {
                            field: 'notification_webhook',
                            value: [
                                'status_change_endpoint',
                                '{"tags":"{{ticket.tags}}","status":"{{ticket.status}}"}\n',
                            ],
                        },
                    ],
                },
            },
        })
    )

    const translations = zip.folder('translations')

    if (!translations) {
        console.error('Failure.')
        process.exit(1)
    }

    translations.file(
        'en.json',
        JSON.stringify({
            app: {
                name: 'Zendesk Discord Integration Installer',
                short_description: 'Installs the Zendesk Discord integration.',
                long_description: 'Installs the Zendesk Discord integration.',
                installation_instructions: 'Just click install.',
            },
        })
    )

    return zip.generateNodeStream()
}

if (require.main === module) {
    dotenv.config()
    const site = process.env.SITE
    const secret = process.env.SIGNING_SECRET

    if (!site || !secret) {
        console.error('Site not specified in SITE .env entry/environment variable.')
        process.exit(1)
    }

    createZipStream(site, secret).pipe(createWriteStream('zendesk-installer.zip'))
}
