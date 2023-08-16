export interface ExternalResource {
    external_id: string
    internal_note?: boolean
    message: string
    parent_id?: string
    thread_id?: string
    created_at: string
    author: Author
    allow_channelback?: boolean
    fields?: Field[]
    file_urls?: string[]
}

export interface Author {
    external_id: string
    name?: string
    image_url?: string
    locale?: string
    fields?: Field[]
}

export interface Field {
    /**
     * @see https://developer.zendesk.com/documentation/channel_framework/understanding-the-channel-framework/pull_endpoint/#field-object
     */
    id: string
    value: any
}

export interface ChannelbackRequest {
    message: string
    thread_id: string
    file_urls?: string[]
}

export interface ClickthroughRequest {
    external_id: string
}

export interface Metadata {
    /**
     * Unique identifier for bot identication
     */
    uuid: string
    /**
     * Discord token
     */
    token: string
    /**
     * Discord forum channel
     */
    channel: string

    // Push data
    subdomain?: string
    instance_push_id?: string
    zendesk_access_token?: string
}
