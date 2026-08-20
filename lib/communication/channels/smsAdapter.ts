/**
 * SMS Channel Adapter (Twilio)
 *
 * Wraps the Twilio SMS integration. This is a conditional provider —
 * only active when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and
 * TWILIO_PHONE_NUMBER are all configured.
 *
 * If credentials are missing, the adapter reports as 'unconfigured'
 * and refuses to send. It never fabricates delivery or simulates
 * sending in production.
 */

import type { ChannelId, ChannelDescriptor } from '../types';

export interface SmsAdapterConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
}

export interface SmsSendRequest {
  to: string;
  body: string;
}

export interface SmsSendResult {
  success: boolean;
  providerMessageId: string | null;
  provider: string;
  error: string | null;
}

const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

export class SmsAdapter {
  readonly channelId: ChannelId = 'sms';
  private accountSid: string | undefined;
  private authToken: string | undefined;
  private fromNumber: string | undefined;

  constructor(config?: SmsAdapterConfig) {
    this.accountSid = config?.accountSid || process.env.TWILIO_ACCOUNT_SID;
    this.authToken = config?.authToken || process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = config?.fromNumber || process.env.TWILIO_PHONE_NUMBER;
  }

  getDescriptor(): ChannelDescriptor {
    const configured = this.isConfigured();
    return {
      channelId: 'sms',
      name: 'SMS (Twilio)',
      direction: 'outbound',
      status: configured ? 'active' : 'unconfigured',
      inboundSupport: false, // inbound SMS requires webhook setup
      outboundSupport: true,
      persistenceSupport: false,
      credentialsConfigured: configured,
      runtimeReachable: configured,
      autonomySupport: true,
      blocker: configured ? null : 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER must be configured',
      metadata: { provider: 'twilio' },
    };
  }

  isConfigured(): boolean {
    return !!(this.accountSid && this.authToken && this.fromNumber);
  }

  validatePhoneNumber(phone: string): boolean {
    return PHONE_REGEX.test(phone.replace(/[\s\-()]/g, ''));
  }

  async send(request: SmsSendRequest): Promise<SmsSendResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'twilio',
        error: 'Twilio not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)',
      };
    }

    if (!this.validatePhoneNumber(request.to)) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'twilio',
        error: `Invalid phone number: ${request.to}`,
      };
    }

    if (!request.body || request.body.length === 0) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'twilio',
        error: 'SMS body is required',
      };
    }

    // Twilio SMS body limit is 1600 chars
    if (request.body.length > 1600) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'twilio',
        error: 'SMS body exceeds 1600 character limit',
      };
    }

    try {
      const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: request.to,
            From: this.fromNumber!,
            Body: request.body,
          }),
        },
      );

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return {
          success: false,
          providerMessageId: null,
          provider: 'twilio',
          error: `Twilio API error ${res.status}: ${detail}`.trim(),
        };
      }

      const data = (await res.json().catch(() => ({}))) as { sid?: string };
      return {
        success: true,
        providerMessageId: data.sid || null,
        provider: 'twilio',
        error: null,
      };
    } catch (e) {
      return {
        success: false,
        providerMessageId: null,
        provider: 'twilio',
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
  }
}
