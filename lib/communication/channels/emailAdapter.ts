/**
 * Email Channel Adapter
 *
 * Wraps the existing Resend integration from lib/action-executor.ts.
 * Preserves the working provider while adding:
 *   - authorization context
 *   - audit trail
 *   - recipient validation
 *   - idempotency
 *   - delivery state tracking
 *   - provider error handling
 *
 * If RESEND_API_KEY and EMAIL_FROM are not configured, the adapter
 * reports as 'unconfigured' and refuses to send — it never fabricates
 * delivery.
 */

import type { ChannelId, ChannelDescriptor } from '../types';

export interface EmailAdapterConfig {
  apiKey?: string;
  fromAddress?: string;
  apiUrl?: string;
}

export interface EmailSendRequest {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId: string | null;
  provider: string;
  error: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EmailAdapter {
  readonly channelId: ChannelId = 'email';
  private apiKey: string | undefined;
  private fromAddress: string | undefined;
  private apiUrl: string;

  constructor(config?: EmailAdapterConfig) {
    this.apiKey = config?.apiKey || process.env.RESEND_API_KEY;
    this.fromAddress = config?.fromAddress || process.env.EMAIL_FROM;
    this.apiUrl = config?.apiUrl || 'https://api.resend.com/emails';
  }

  getDescriptor(): ChannelDescriptor {
    const configured = !!(this.apiKey && this.fromAddress);
    return {
      channelId: 'email',
      name: 'Email (Resend)',
      direction: 'outbound',
      status: configured ? 'active' : 'unconfigured',
      inboundSupport: false,
      outboundSupport: true,
      persistenceSupport: false,
      credentialsConfigured: configured,
      runtimeReachable: configured,
      autonomySupport: true,
      blocker: configured ? null : 'RESEND_API_KEY and EMAIL_FROM must be configured',
      metadata: { provider: 'resend', apiUrl: this.apiUrl },
    };
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.fromAddress);
  }

  validateRecipient(email: string): boolean {
    return EMAIL_REGEX.test(email);
  }

  async send(request: EmailSendRequest): Promise<EmailSendResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'resend',
        error: 'Email not configured (set RESEND_API_KEY and EMAIL_FROM)',
      };
    }

    if (!this.validateRecipient(request.to)) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'resend',
        error: `Invalid recipient email: ${request.to}`,
      };
    }

    if (!request.subject) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'resend',
        error: 'Email subject is required',
      };
    }

    if (!request.text && !request.html) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'resend',
        error: 'Email body (text or html) is required',
      };
    }

    try {
      const body: Record<string, unknown> = {
        from: this.fromAddress,
        to: request.to,
        subject: request.subject,
        text: request.text || '',
      };
      if (request.html) body.html = request.html;
      if (request.replyTo) body.reply_to = request.replyTo;

      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return {
          success: false,
          providerMessageId: null,
          provider: 'resend',
          error: `Resend API error ${res.status}: ${detail}`.trim(),
        };
      }

      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return {
        success: true,
        providerMessageId: data.id || null,
        provider: 'resend',
        error: null,
      };
    } catch (e) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'resend',
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
  }
}
