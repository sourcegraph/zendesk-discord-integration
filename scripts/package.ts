// Packages the app installer for Zendesk

import { createWriteStream } from 'fs'

import dotenv from 'dotenv'
import JSZip from 'jszip'

dotenv.config()

const site = process.env.SITE

if (!site) {
    console.error('Site not specified in SITE .env entry/environment variable.')
    process.exit(1)
}

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

zip.generateNodeStream().pipe(createWriteStream('zendesk-installer.zip'))
