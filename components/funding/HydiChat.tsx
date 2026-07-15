import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Campaign, ChatMessage } from '../../lib/zlabs/types';
import { getPipelineStats } from '../../lib/zlabs/data';

const STARTER_PROMPTS = [
  'What should I prioritize today?',
  'Which grants are due soon?',
  'Draft an email for Toyota partnership',
];

interface HydiChatProps {
  campaigns: Campaign[];
  stats: ReturnType<typeof getPipelineStats>;
  initialPrompt?: string | null;
  onPromptConsumed?: () => void;
}

export default function HydiChat({ campaigns, stats, initialPrompt, onPromptConsumed }: HydiChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/funding/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, context: { campaigns, stats } }),
      });
      const data = await res.json();
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.response ?? data.error ?? 'No response received.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev.slice(-19), assistantMsg]);
    } catch {
      const errMsg: ChatMessage = {
        role: 'assistant',
        content: 'Failed to reach Hydi. Please try again.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [campaigns, stats, isLoading]);

  useEffect(() => {
    if (initialPrompt) {
      sendMessage(initialPrompt);
      onPromptConsumed?.();
    }
  }, [initialPrompt, sendMessage, onPromptConsumed]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="bg-white border rounded-lg shadow-sm flex flex-col" style={{ height: '480px' }}>
      <div className="px-4 py-3 border-b">
        <h2 className="text-sm font-semibold text-gray-900">Hydi AI Assistant</h2>
        <p className="text-xs text-gray-500">Z-Labs funding intelligence</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-xs mt-4">
            <p className="mb-3">Ask Hydi about your funding pipeline</p>
            <div className="flex flex-col gap-1.5">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left text-xs px-3 py-2 border border-blue-200 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-xs px-3 py-2 rounded-lg text-xs ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <p style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</p>
              <p className="opacity-60 mt-1 text-right" style={{ fontSize: '0.65rem' }}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-3 py-2 rounded-lg">
              <div className="flex items-center space-x-1">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t px-3 py-2">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your pipeline..."
            className="flex-1 text-xs px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="text-xs px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
