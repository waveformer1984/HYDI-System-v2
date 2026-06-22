import React, { useState, useRef, useEffect } from 'react';
import { useHeidi } from '../hooks/useHeidi';

interface ChatProps {
  sessionId: string;
}

export default function Chat({ sessionId }: ChatProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, isLoading, error, sendMessage } = useHeidi(sessionId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      await sendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        sendMessage(input.trim());
        setInput('');
      }
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 px-4 py-3 bg-white">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Heidi</h1>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`} />
            <span className="text-xs text-gray-500 hidden sm:inline">
              {isLoading ? 'Thinking…' : 'Online'}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 sm:px-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center text-gray-400 px-4">
            <div>
              <p className="font-medium">Welcome to Heidi</p>
              <p className="text-sm mt-1">How can I help you today?</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-md px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                {message.actions && message.actions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/20 space-y-0.5">
                    {message.actions.map((action, index) => (
                      <p key={index} className="text-xs opacity-80">
                        • {String((action as Record<string, unknown>).type ?? '')}
                      </p>
                    ))}
                  </div>
                )}
                <p className={`text-[10px] mt-1 ${message.role === 'user' ? 'text-white/60 text-right' : 'text-gray-400'}`}>
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-sm">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-50 text-red-600 border border-red-200 px-3 py-2 rounded-lg text-sm max-w-[85%] sm:max-w-md">
              {error}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-white px-3 py-3 sm:px-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={handleKeyDown}
            placeholder="Message Heidi…"
            disabled={isLoading}
            className="flex-1 resize-none overflow-hidden px-4 py-2.5 bg-gray-100 border-0 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors disabled:opacity-50 min-h-[42px] max-h-[120px]"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            aria-label="Send"
            className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors touch-manipulation"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 ml-0.5">
              <path d="M3.105 2.289a.75.75 0 00-.826.95l1.903 6.557H13.5a.75.75 0 010 1.5H4.182l-1.903 6.557a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
            </svg>
          </button>
        </form>
        <p className="text-[10px] text-gray-400 text-center mt-1.5 hidden sm:block">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
