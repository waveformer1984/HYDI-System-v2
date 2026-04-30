/**
 * COMPONENTS - Chat.tsx
 * 
 * Streaming chat window with model status and action logging
 */

import React, { useState, useRef, useEffect } from 'react';
import { useHeidi } from '../hooks/useHeidi';

interface ChatProps {
  sessionId: string;
}

export default function Chat({ sessionId }: ChatProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const {
    messages,
    isLoading,
    error,
    sessionState,
    systemStatus,
    sendMessage,
    getModelStatus,
    getActiveModel
  } = useHeidi(sessionId);

  // Auto-scroll to bottom
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

  const getModelStatusColor = () => {
    const status = getModelStatus();
    switch (status) {
      case 'healthy': return 'text-green-600';
      case 'degraded': return 'text-yellow-600';
      case 'api-fallback': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  const getModelStatusText = () => {
    const status = getModelStatus();
    switch (status) {
      case 'healthy': return 'Local Model Active';
      case 'degraded': return 'Model Degraded';
      case 'api-fallback': return 'API Fallback Active';
      default: return 'Status Unknown';
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      {/* Header with status */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Heidi</h1>
          <div className="flex items-center space-x-4 text-sm">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${getModelStatusColor()}`}></div>
              <span className={getModelStatusColor()}>{getModelStatusText()}</span>
            </div>
            <div className="text-gray-600">
              Model: {getActiveModel()}
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <p>Welcome to Heidi!</p>
            <p className="text-sm mt-2">How can I help you today?</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <p className="text-sm">{message.content}</p>
                {message.actions && message.actions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-300">
                    <p className="text-xs font-semibold">Actions:</p>
                    {message.actions.map((action, index) => (
                      <p key={index} className="text-xs">
                        • {action.type}
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-xs opacity-70 mt-1">
                  {message.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-900 px-4 py-2 rounded-lg">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="flex justify-center">
            <div className="bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">
              Error: {error}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
