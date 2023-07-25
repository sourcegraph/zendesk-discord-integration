import axios, { Axios } from 'axios'

export type Status = 'new' | 'open' | 'pending' | 'hold' | 'solved' | 'closed'

export interface Comment {
    body?: string
    public?: boolean
}

export interface Follower {
    user_email: string
    action: 'put'
}

export interface Ticket {
    readonly id?: number
    subject?: string
    comment?: Comment
    status?: Status
    followers?: Follower[]
}

export type ActivityVerb = 'tickets.assignment' | 'tickets.comment' | 'tickets.priority_increase'

export interface Activity {
    verb: ActivityVerb
}

export type ActivityStream = Activity[]

export class Client {
    private apiClient: Axios

    constructor(
        private apiRoot: string,
        token: string,
        email: string
    ) {
        this.apiClient = axios.create({
            headers: {
                Authorization: `Basic ${Buffer.from(`${email}/token:${token}`, 'utf8').toString('base64')}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        })
    }

    public async createTicket(ticket: Ticket): Promise<Ticket> {
        return (
            await this.apiClient.post(`${this.apiRoot}/tickets`, {
                ticket,
            })
        ).data.ticket
    }

    public async updateTicket(ticketId: number, ticket: Ticket): Promise<Ticket> {
        return (
            await this.apiClient.put(`${this.apiRoot}/tickets/${ticketId}`, {
                ticket,
            })
        ).data.ticket
    }

    public async getActivityStream(since?: Date): Promise<ActivityStream> {
        return (
            await this.apiClient.get(`${this.apiRoot}/activities`, {
                headers: {
                    Accept: 'application/json',
                },
                ...(since
                    ? {
                          params: {
                              since: since.toISOString(),
                          },
                      }
                    : {}),
            })
        ).data.activities
    }
}

export default {
    Client,
}
