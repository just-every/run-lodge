export function addresses(value: string): string[]
export interface InboundMail {
 messageId: string | null
 subject: string
 text: string | null
 html: string | null
 attachments: { filename: string; contentType: string; content: Uint8Array }[]
}
export function normalizeInbound(input: { provider: 'cloudflare'; message: ForwardableEmailMessage }, limits: { maxRawBytes: number; maxBodyBytes: number; maxAttachments: number; maxAttachmentBytes: number; maxTotalAttachmentBytes: number }): Promise<InboundMail>
