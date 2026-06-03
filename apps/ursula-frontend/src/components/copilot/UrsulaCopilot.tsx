'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Sparkles, CheckCircle, HelpCircle, Volume2, VolumeX } from 'lucide-react';
import VoiceInput from './VoiceInput';
import VoiceOutput from './VoiceOutput';
import Tooltip, { CommandTooltip, SuggestionTooltip, QuickTipTooltip } from './Tooltip';
import { projectOps } from '@/lib/projectOpsClient';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type AssistantCardKind = 'analysis' | 'plan' | 'task' | 'error' | 'suggestion' | 'default';

interface CopilotProps {
  className?: string;
}

export default function UrsulaCopilot({ className = '' }: CopilotProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '🚀 **Ursula Copilot Online**\n\nI\'m connected to your local Project Ops API with Ollama models. I can help you with:\n\n• Code generation and review\n• Task decomposition and planning\n• ProtoForge workflow assistance\n• HYDI task management\n• Local model operations\n\nHow can I assist you today?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedModel, setSelectedModel] = useState('qwen2.5-coder:1.5b');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isReading, setIsReading] = useState(false);
  const [lastAssistantMessage, setLastAssistantMessage] = useState('');
  const [isAutoReadEnabled, setIsAutoReadEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getAssistantCardKind = (content: string): AssistantCardKind => {
    const text = content.toLowerCase();
    if (text.includes('**error**') || text.startsWith('❌')) return 'error';
    if (text.includes('**hydi task generated**') || text.includes('task id:')) return 'task';
    if (text.includes('**assertive action plan**') || text.includes('action plan')) return 'plan';
    if (text.includes('**current state analysis**') || text.includes('analysis')) return 'analysis';
    if (text.includes('**proactive suggestion**') || text.includes('suggestion')) return 'suggestion';
    return 'default';
  };

  const getAssistantCardClasses = (kind: AssistantCardKind): string => {
    switch (kind) {
      case 'analysis':
        return 'border-blue-500/40 bg-blue-900/10';
      case 'plan':
        return 'border-purple-500/40 bg-purple-900/10';
      case 'task':
        return 'border-emerald-500/40 bg-emerald-900/10';
      case 'error':
        return 'border-red-500/40 bg-red-900/10';
      case 'suggestion':
        return 'border-yellow-500/40 bg-yellow-900/10';
      default:
        return 'border-gray-700';
    }
  };

  const extractTaskIdFromMessage = (content: string): string | null => {
    const match = content.match(/\*\*Task ID:\*\*\s*([^\n\r]+)/i) || content.match(/task id:\s*([^\n\r]+)/i);
    return match ? String(match[1]).trim() : null;
  };

  const runChip = async (text: string): Promise<void> => {
    setInput(text);
    setTimeout(() => {
      void sendMessage();
    }, 0);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Track new assistant messages for voice output
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      // Clean up markdown and formatting for speech
      const cleanText = lastMessage.content
        .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
        .replace(/\*(.*?)\*/g, '$1') // Remove italic
        .replace(/`(.*?)`/g, '$1') // Remove inline code
        .replace(/```[\s\S]*?```/g, 'code block') // Replace code blocks
        .replace(/#{1,6}\s/g, '') // Remove headers
        .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
        .trim();

      setLastAssistantMessage(cleanText);
    }
  }, [messages]);

  useEffect(() => {
    // Check Project Ops API connection and load models
    checkConnection();
    loadAvailableModels();
  }, []);

  const loadAvailableModels = async () => {
    try {
      const data = await projectOps.listModels();
      if (data.available) {
        setAvailableModels(data.models.map((m: any) => m.name));
        if (data.models.length > 0) {
          setSelectedModel(data.default_model || data.models[0].name);
        }
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const checkConnection = async () => {
    try {
      const data = await projectOps.health();
      setIsConnected(!!data.ollama_available);
    } catch (error) {
      setIsConnected(false);
    }
  };

  const handleVoiceTranscript = (transcript: string) => {
    setInput(transcript);
    // Auto-send after voice input
    setTimeout(() => {
      sendMessage();
    }, 500);
  };

  const generateHYDITask = async (objective: string) => {
    try {
      const data = await projectOps.generateHYDITask(objective);
      if (data.success && data.task) return data.task;
      throw new Error(data.error || 'Task generation failed');
    } catch (error) {
      console.error('HYDI task generation failed:', error);
      throw error;
    }
  };

  const executeHYDITask = async (taskId: string) => {
    try {
      const data = await projectOps.executeHYDITask(taskId);
      if (data.success && data.result) return data.result;
      throw new Error(data.error || 'Task execution failed');
    } catch (error) {
      console.error('HYDI task execution failed:', error);
      throw error;
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const data = await projectOps.chat([
        {
          role: 'system',
          content: 'You are Ursula Copilot, an AI assistant integrated with ProtoForge and HYDI systems. You help with code generation, task management, and local model operations. Be concise, helpful, and actionable.',
        },
        {
          role: 'user',
          content: input,
        },
      ], selectedModel);

      if (data.success && data.response) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error(data.error || 'Failed to get response');
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ **Connection Error**\n\nUnable to reach Project Ops API. Please ensure:\n\n• Project Ops server is running on port 3100\n• Ollama is running on port 11434\n• Local models are available\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className={`flex flex-col h-full bg-gray-900 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Bot className="w-5 h-5 text-blue-400" />
            {isConnected && (
              <CheckCircle className="w-3 h-3 text-green-400 absolute -bottom-1 -right-1" />
            )}
          </div>
          <div>
            <h3 className="text-white font-medium">Ursula Copilot</h3>
            <p className="text-xs text-gray-400">
              {isConnected ? 'Connected to Project Ops' : 'Offline'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Tooltip
            type="info"
            content={isAutoReadEnabled ? 'Auto-read is ON' : 'Auto-read is OFF'}
            position="bottom"
          >
            <button
              type="button"
              onClick={() => setIsAutoReadEnabled(v => !v)}
              className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 transition-colors"
              title={isAutoReadEnabled ? 'Disable auto-read' : 'Enable auto-read'}
            >
              {isAutoReadEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </Tooltip>
          <Sparkles className="w-4 h-4 text-yellow-400" />
          <span className="text-xs text-gray-400">Local Models</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runChip('what should we work on now?')}
            disabled={isLoading}
            className="px-2.5 py-1.5 rounded-full bg-blue-600/15 border border-blue-500/20 text-blue-200 hover:bg-blue-600/25 disabled:opacity-50 text-xs"
          >
            Status
          </button>
          <button
            type="button"
            onClick={() => runChip('identify blockers')}
            disabled={isLoading}
            className="px-2.5 py-1.5 rounded-full bg-amber-600/15 border border-amber-500/20 text-amber-200 hover:bg-amber-600/25 disabled:opacity-50 text-xs"
          >
            Blockers
          </button>
          <button
            type="button"
            onClick={() => runChip('quick wins')}
            disabled={isLoading}
            className="px-2.5 py-1.5 rounded-full bg-emerald-600/15 border border-emerald-500/20 text-emerald-200 hover:bg-emerald-600/25 disabled:opacity-50 text-xs"
          >
            Quick wins
          </button>
          <button
            type="button"
            onClick={() => runChip('plan: [objective]')}
            disabled={isLoading}
            className="px-2.5 py-1.5 rounded-full bg-purple-600/15 border border-purple-500/20 text-purple-200 hover:bg-purple-600/25 disabled:opacity-50 text-xs"
          >
            Plan
          </button>
          <button
            type="button"
            onClick={() => runChip('generate task: [objective]')}
            disabled={isLoading}
            className="px-2.5 py-1.5 rounded-full bg-emerald-600/15 border border-emerald-500/20 text-emerald-200 hover:bg-emerald-600/25 disabled:opacity-50 text-xs"
          >
            Generate task
          </button>
        </div>
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex items-start space-x-3 ${message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
              }`}
          >
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${message.role === 'user'
              ? 'bg-blue-600'
              : 'bg-gray-700'
              }`}>
              {message.role === 'user' ? (
                <User className="w-4 h-4 text-white" />
              ) : (
                <Bot className="w-4 h-4 text-blue-400" />
              )}
            </div>
            <div className={`flex-1 max-w-3xl ${message.role === 'user' ? 'text-right' : ''
              }`}>
              {(() => {
                const kind = message.role === 'assistant' ? getAssistantCardKind(message.content) : 'default';
                const assistantCard = message.role === 'assistant'
                  ? `bg-gray-800 text-gray-100 border ${getAssistantCardClasses(kind)}`
                  : 'bg-blue-600 text-white border border-blue-500';
                return (
                  <div className={`inline-block p-3 rounded-lg border ${assistantCard}`}>
                    <div className="whitespace-pre-wrap text-sm">
                      {message.content}
                    </div>
                  </div>
                );
              })()}
              <div className="mt-1 text-xs text-gray-500">
                {message.timestamp.toLocaleTimeString()}
              </div>
              {message.role === 'assistant' && (
                <div className="mt-2">
                  {(() => {
                    const taskId = extractTaskIdFromMessage(message.content);
                    if (!taskId) return null;
                    return (
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => runChip(`execute task ${taskId}`)}
                          disabled={isLoading}
                          className="px-2 py-1 rounded-md bg-emerald-600/20 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-600/30 disabled:opacity-50 text-xs"
                        >
                          Execute task
                        </button>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(taskId)}
                          className="px-2 py-1 rounded-md bg-gray-900/30 border border-gray-700 text-gray-200 hover:bg-gray-900/50 text-xs"
                        >
                          Copy ID
                        </button>
                      </div>
                    );
                  })()}
                  <VoiceOutput
                    text={message.content}
                    autoPlay={isAutoReadEnabled}
                    isPlaying={isReading && lastAssistantMessage === message.content.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`(.*?)`/g, '$1').replace(/```[\s\S]*?```/g, 'code block').replace(/#{1,6}\s/g, '').replace(/\n{3,}/g, '\n\n').trim()}
                    onPlayStateChange={setIsReading}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                  />
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
              <Bot className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1">
              <div className="inline-block p-3 rounded-lg bg-gray-800">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center space-x-2">
          <Tooltip
            type="quick-tip"
            content="Click to use voice input. Speak your question or command clearly."
            position="top"
          >
            <div>
              <VoiceInput
                onTranscript={handleVoiceTranscript}
                isDisabled={!isConnected || isLoading}
              />
            </div>
          </Tooltip>

          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                isConnected
                  ? "Ask me anything... (or use voice input)"
                  : "Waiting for connection to Project Ops..."
              }
              disabled={!isConnected || isLoading}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 disabled:opacity-50 pr-10"
            />

            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <CommandTooltip
                command="what should we work on now?"
                description="Get proactive analysis and suggestions"
              />
            </div>
          </div>

          <Tooltip
            type="command"
            content="Send message or use voice input"
            position="top"
          >
            <button
              onClick={sendMessage}
              disabled={!isConnected || isLoading || !input.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              <Send className="w-4 h-4" />
              <span>Send</span>
            </button>
          </Tooltip>
        </div>
        {isConnected && (
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs text-gray-400">
              Powered by local Ollama models via Project Ops API • Voice input & output available
            </div>

            <div className="flex items-center space-x-2">
              <SuggestionTooltip suggestion="Try asking me to generate HYDI tasks or analyze your workflow" />
              <QuickTipTooltip tip="Use Ctrl+Shift+C to open the floating copilot!" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
