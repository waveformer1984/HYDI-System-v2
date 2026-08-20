/**
 * HEIDI Core Channel Adapter
 *
 * Wraps the existing local Heidi Core server (port 3459, Ollama-backed)
 * as a communication channel. This is the primary local-first AI chat
 * provider — no cloud dependency.
 *
 * Routes through Heidi Core's /chat-tools endpoint (real tool execution)
 * with /think-stream as the tool-less fallback. Both speak the same SSE
 * protocol.
 */

import type { ChannelId, ChannelDescriptor, ChannelStatus } from '../types';

export interface HeidiCoreConfig {
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export interface HeidiCoreChatRequest {
  message: string;
  model?: string;
  context?: Record<string, unknown>;
}

export interface HeidiCoreChatResult {
  text: string;
  model: string;
  provider: string;
  toolsUsed: string[];
  latencyMs: number;
  fallback: boolean;
  error: string | null;
}

export class HeidiCoreAdapter {
  readonly channelId: ChannelId = 'heidi_core';
  private baseUrl: string;
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config?: HeidiCoreConfig) {
    this.baseUrl = config?.baseUrl || process.env.HEIDI_CORE_URL || 'http://localhost:3459';
    this.defaultModel = config?.defaultModel || process.env.LOCAL_MODEL_NAME || 'llama3.2:3b';
    this.timeoutMs = config?.timeoutMs || 120000;
  }

  getDescriptor(): ChannelDescriptor {
    return {
      channelId: 'heidi_core',
      name: 'Heidi Core (local Ollama)',
      direction: 'bidirectional',
      status: 'active',
      inboundSupport: true,
      outboundSupport: true,
      persistenceSupport: false, // persistence is the ConversationStore's job
      credentialsConfigured: true, // no external credentials needed
      runtimeReachable: false, // verified at runtime
      autonomySupport: true,
      blocker: null,
      metadata: { baseUrl: this.baseUrl, defaultModel: this.defaultModel },
    };
  }

  async checkReachability(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === 'healthy' || data.brain === 'connected';
    } catch {
      return false;
    }
  }

  async chat(request: HeidiCoreChatRequest): Promise<HeidiCoreChatResult> {
    const startTime = Date.now();
    const model = request.model || this.defaultModel;
    const attempts = ['/chat-tools', '/think-stream'];

    let lastError: string | null = null;

    for (const corePath of attempts) {
      try {
        const text = await this.streamFromCore(corePath, request.message, model);
        if (text && text.trim().length > 0) {
          return {
            text,
            model,
            provider: 'heidi_core',
            toolsUsed: corePath === '/chat-tools' ? ['chat-tools'] : [],
            latencyMs: Date.now() - startTime,
            fallback: corePath === '/think-stream',
            error: null,
          };
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Unknown error';
      }
    }

    return {
      text: '',
      model,
      provider: 'heidi_core',
      toolsUsed: [],
      latencyMs: Date.now() - startTime,
      fallback: true,
      error: lastError || 'No response from Heidi Core',
    };
  }

  private async streamFromCore(path: string, message: string, model: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: message,
          options: model ? { model } : {},
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Heidi Core ${path} returned ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.t) fullText += data.t;
            } catch {
              // partial JSON, skip
            }
          }
        }
      }

      return fullText;
    } finally {
      clearTimeout(timer);
    }
  }
}
