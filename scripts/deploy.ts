import axiosDefault from 'axios'
import dotenv from 'dotenv'
import FormData from 'form-data'

import { createZipStream } from './package'

dotenv.config()
const site = process.env.SITE
const secret = process.env.SECRET
const subdomain = process.env.DEPLOY_SUBDOMAIN
const authorization = process.env.DEPLOY_AUTHORIZATION

if (!site || !secret || !subdomain || !authorization) {
    console.error('Missing env vars.')
    process.exit(1)
}

const axios = axiosDefault.create({
    headers: {
        Authorization: authorization,
    },
})

const sleep = (ms: number) => new Promise(resolve => setTimeout(() => resolve(void {}), ms))

;(async () => {
    const owned = (await axios.get(`https://${subdomain}.zendesk.com/api/v2/apps/owned.json`)).data.apps
    const existingApp = owned.find((app: any) => app.name === 'Zendesk Discord Integration')

    if (existingApp) {
        console.log('Found existing app, deleting...')
        await axios.delete(`https://${subdomain}.zendesk.com/api/v2/apps/${existingApp.id}`)
    }

    const formData = new FormData()
    formData.append('uploaded_data', createZipStream(site, secret), {
        contentType: 'application/zip',
        filename: 'app.zip',
    })

    const uploadId = (
        await axios.post(`https://${subdomain}.zendesk.com/api/v2/apps/uploads.json`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        })
    ).data.id

    if (typeof uploadId !== 'number') {
        console.error('Invalid id returned', uploadId)
        return
    }

    const createJobId = (
        await axios.post(
            `https://${subdomain}.zendesk.com/api/apps`,
            {
                product_name: 'support',
                name: 'Zendesk Discord Integration',
                upload_id: `${uploadId}`,
                create: 'true',
            },
            {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            }
        )
    ).data.job_id

    for (let i = 0; i < 5; i++) {
        await sleep(2500)

        const res = (await axios.get(`https://${subdomain}.zendesk.com/api/v2/apps/job_statuses/${createJobId}`)).data
        if (res.status === 'completed') {
            await axios.post(
                `https://${subdomain}.zendesk.com/api/v2/apps/installations`,
                {
                    app_id: res.app_id,
                    settings: {
                        name: 'Zendesk Discord Integration',
                    },
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            )
            break
        }
    }
})()
