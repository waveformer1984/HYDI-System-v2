/**
 * Anthropic Channel Adapter
 *
 * Wraps the existing Anthropic integration from lib/heidi-agent.ts.
 * This is a conditional provider — only active when ANTHROPIC_API_KEY
 * is configured and valid. Local Ollama (HeidiCoreAdapter) remains the
 * preferred AI path unless policy explicitly selects this provider.
 *
 * If the credential is missing, the adapter reports as 'unconfigured'
 * and refuses to process — it never fabricates availability.
 */

import type { ChannelId, ChannelDescriptor } from '../types';

export interface AnthropicAdapterConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export interface AnthropicChatRequest {
  message: string;
  sessionId: string;
  userId: string;
  systemPrompt?: string;
  memoryContext?: string;
}

export interface AnthropicChatResult {
  text: string;
  model: string;
  provider: string;
  toolsUsed: string[];
  latencyMs: number;
  error: string | null;
}

export class AnthropicAdapter {
  readonly channelId: ChannelId = 'web_chat';
  private apiKey: string | undefined;
  private model: string;
  private maxTokens: number;

  constructor(config?: AnthropicAdapterConfig) {
    this.apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = config?.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    this.maxTokens = config?.maxTokens || 2048;
  }

  getDescriptor(): ChannelDescriptor {
    const configured = this.isConfigured();
    return {
      channelId: 'web_chat',
      name: 'Anthropic Claude (cloud)',
      direction: 'bidirectional',
      status: configured ? 'active' : 'unconfigured',
      inboundSupport: true,
      outboundSupport: true,
      persistenceSupport: false,
      credentialsConfigured: configured,
      runtimeReachable: configured,
      autonomySupport: true,
      blocker: configured ? null : 'ANTHROPIC_API_KEY not configured — local Ollama is the preferred provider',
      metadata: { model: this.model, provider: 'anthropic' },
    };
  }

  isConfigured(): boolean {
    if (!this.apiKey) return false;
    const normalized = this.apiKey.toLowerCase();
    return normalized.startsWith('sk-ant') || normalized.startsWith('sk-');
  }

  async checkReachability(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    // We don't make a test API call to avoid burning credits.
    // The adapter is considered reachable if the key is present and valid-looking.
    return true;
  }

  async chat(request: AnthropicChatRequest): Promise<AnthropicChatResult> {
    const startTime = Date.now();

    if (!this.isConfigured()) {
      return {
        text: '',
        model: this.model,
        provider: 'anthropic',
        toolsUsed: [],
        latencyMs: 0,
        error: 'ANTHROPIC_API_KEY not configured',
      };
    }

    try {
      // Use the existing heidi-agent module to preserve tool-calling behavior
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { runHeidiAgentStream } = require('../../heidi-agent');

      let fullText = '';
      const result = await runHeidiAgentStream({
        message: request.message,
        sessionId: request.sessionId,
        userId: request.userId,
        onText: (delta: string) => { fullText += delta; },
      });

      return {
        text: fullText || result.text,
        model: result.model || this.model,
        provider: 'anthropic',
        toolsUsed: result.actions.map((a: { type: string }) => a.type),
        latencyMs: Date.now() - startTime,
        error: null,
      };
    } catch (e) {
      return {
        text: '',
        model: this.model,
        provider: 'anthropic',
        toolsUsed: [],
        latencyMs: Date.now() - startTime,
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
  }
}
