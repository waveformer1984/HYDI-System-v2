'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Sparkles, CheckCircle, Minimize2, Maximize2, X, GripVertical, HelpCircle, Volume2, VolumeX } from 'lucide-react';
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

interface FloatingCopilotProps {
  isVisible: boolean;
  onClose: () => void;
  onMinimize: () => void;
  className?: string;
}

export default function FloatingCopilot({ isVisible, onClose, onMinimize, className = '' }: FloatingCopilotProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '🎯 **Proactive Copilot Active**\n\nI\'m here to help you identify and tackle what needs to be done. I can help you with:\n\n• **🔍 Task Discovery** - I\'ll actively identify gaps and next steps\n• **⚡ Immediate Actions** - Quick wins and momentum builders\n• **🎯 Strategic Planning** - Break down complex objectives\n• **🚀 HYDI Task Execution** - Generate and execute tasks automatically\n• **📊 Progress Tracking** - Monitor what\'s complete vs pending\n• **🤝 Collaborative Planning** - Include you in decision-making\n\nI\'ll be more assertive about suggesting actions. What are we working on today?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedModel, setSelectedModel] = useState('qwen2.5-coder:1.5b');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [lastSuggestion, setLastSuggestion] = useState<Date>(new Date());
  const [isReading, setIsReading] = useState(false);
  const [lastAssistantMessage, setLastAssistantMessage] = useState('');
  const [isAutoReadEnabled, setIsAutoReadEnabled] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
        return 'border-gray-600';
    }
  };

  const extractTaskIdFromMessage = (content: string): string | null => {
    const match = content.match(/\*\*Task ID:\*\*\s*([^\n\r]+)/i) || content.match(/task id:\s*([^\n\r]+)/i);
    return match ? String(match[1]).trim() : null;
  };

  const runChip = async (text: string): Promise<void> => {
    setInput(text);
    // allow state flush
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

    // Set up proactive suggestions every 5 minutes
    const suggestionInterval = setInterval(() => {
      if (isConnected && !isLoading && messages.length > 0) {
        const timeSinceLastSuggestion = Date.now() - lastSuggestion.getTime();
        if (timeSinceLastSuggestion > 5 * 60 * 1000) { // 5 minutes
          makeProactiveSuggestion();
        }
      }
    }, 60000); // Check every minute

    return () => clearInterval(suggestionInterval);
  }, [isConnected, isLoading, lastSuggestion]);

  const makeProactiveSuggestion = async () => {
    try {
      const data = await projectOps.chat([
        {
          role: 'system',
          content: 'You are a proactive assistant. Based on the conversation context, suggest a specific, actionable next step. Be assertive but helpful.',
        },
        {
          role: 'user',
          content: 'Looking at our conversation, what specific action should we consider taking next? Be direct and specific.',
        },
      ], selectedModel);

      if (data.success && data.response) {
        const suggestionMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `💡 **Proactive Suggestion**\n\n${data.response}\n\nShould we proceed with this, or would you like to explore a different direction?`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, suggestionMessage]);
        setLastSuggestion(new Date());
      }
    } catch (error) {
      console.error('Failed to make proactive suggestion:', error);
    }
  };

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

  const analyzeCurrentState = async () => {
    try {
      const data = await projectOps.chat([
        {
          role: 'system',
          content: 'You are a proactive project management assistant. Analyze the current state and identify what needs to be done. Be assertive and specific about immediate actions needed.',
        },
        {
          role: 'user',
          content: 'Analyze the current HYDI/ProtoForge system state and identify 3-5 immediate actions that should be taken. Focus on gaps, blockers, and quick wins. Be specific and assertive.',
        },
      ], selectedModel);
      return data.response || '';
    } catch (error) {
      throw new Error('Failed to analyze current state');
    }
  };

  const generateActionPlan = async (objective: string) => {
    try {
      const data = await projectOps.chat([
        {
          role: 'system',
          content: 'You are an assertive project manager. Break down objectives into specific, actionable steps with priorities. Include who should do what and when.',
        },
        {
          role: 'user',
          content: `Create an assertive action plan for: ${objective}. Include specific steps, priorities, and immediate next actions. Be direct and actionable.`,
        },
      ], selectedModel);
      return data.response || '';
    } catch (error) {
      throw new Error('Failed to generate action plan');
    }
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
      // Check for proactive and assertive commands
      const lowerInput = input.toLowerCase().trim();

      if (lowerInput.includes('what should') || lowerInput.includes('what needs') || lowerInput.includes('status check') || lowerInput.includes('analyze')) {
        // Proactive state analysis
        const analysis = await analyzeCurrentState();
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `🔍 **Current State Analysis**\n\n${analysis}\n\n**🎯 Immediate Actions Required:**\nBased on this analysis, I recommend we prioritize the above items. Would you like me to generate HYDI tasks for any of these?`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);
        return;
      }

      if (lowerInput.includes('plan') || lowerInput.includes('strategy') || lowerInput.includes('how to')) {
        // Extract objective for action planning
        const objective = input.replace(/^(create\s+)?(action\s+)?(plan\s+for|strategy\s+for|how\s+to)\s*/i, '').trim();
        if (objective) {
          const plan = await generateActionPlan(objective);
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `🎯 **Assertive Action Plan**\n\n${plan}\n\n**⚡ Next Steps:**\nI can generate HYDI tasks for these action items. Which should we tackle first?`,
            timestamp: new Date()
          };
          setMessages(prev => [...prev, assistantMessage]);
          return;
        }
      }

      if (lowerInput.startsWith('hydi generate task') || lowerInput.startsWith('generate task')) {
        // Extract objective from command
        const objective = input.replace(/^(hydi\s+)?generate\s+task\s*/i, '').trim();
        if (!objective) {
          throw new Error('Please provide an objective for the task. Example: "generate task: deploy payment gateway"');
        }

        const task = await generateHYDITask(objective);
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `🎯 **HYDI Task Generated**\n\n**Title:** ${task.title}\n**Description:** ${task.description}\n**Priority:** ${task.priority}\n**Type:** ${task.type}\n**Task ID:** ${task.id}\n\n**🚀 I recommend we execute this now.** Say "execute task ${task.id}" to proceed, or let me know if you want to modify it first.`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);
        return;
      }

      if (lowerInput.startsWith('execute task') || lowerInput.startsWith('run task')) {
        // Extract task ID from command
        const taskId = input.replace(/^(execute|run)\s+task\s*/i, '').trim();
        if (!taskId) {
          throw new Error('Please provide a task ID. Example: "execute task 12345"');
        }

        const result = await executeHYDITask(taskId);
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `⚡ **HYDI Task Execution Complete**\n\n**Task ID:** ${taskId}\n**Status:** ${result.status}\n**Result:** ${result.output || 'Task completed successfully'}\n\n**🎯 What's next?** Let's identify the next priority item or address any blockers that emerged.`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);
        return;
      }

      // Regular chat with enhanced proactive system prompt
      const data = await projectOps.chat([
        {
          role: 'system',
          content: `You are an assertive, proactive, and inquisitive AI assistant integrated with ProtoForge and HYDI systems. Your role is to help identify what needs to be done and take initiative.

**Your Approach:**
- Be ASSERTIVE about suggesting actions and next steps
- Ask INQUISITIVE questions to understand the full context
- Identify GAPS and BLOCKERS proactively
- Suggest SPECIFIC, ACTIONABLE steps
- Take INITIATIVE in proposing solutions
- Be INCLUSIVE by asking for input and collaboration

**Available models:** ${availableModels.join(', ')}
**Current model:** ${selectedModel}

**Assertive Commands I can help with:**
- "what should we work on now?" - Proactive state analysis
- "plan: [objective]" - Generate assertive action plans
- "generate task: [objective]" - Create HYDI tasks
- "execute task [task_id]" - Execute HYDI tasks
- "identify blockers" - Find what's holding us back
- "quick wins" - Suggest immediate momentum builders

**Response Style:**
- Start with action-oriented language
- Ask clarifying questions when needed
- Propose specific next steps
- Be direct but collaborative
- Focus on what needs to be done NOW`,
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
        content: `❌ **Let's Address This**\n\n${error instanceof Error ? error.message : 'Unknown error'}\n\n**🎯 Assertive Next Steps:**\n• "what should we work on now?" - Analyze current state\n• "plan: [your objective]" - Create action plan\n• "generate task: [specific task]" - Create HYDI task\n• "identify blockers" - Find what's holding us back\n\nI'm here to help you take action. What do you want to accomplish?`,
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

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart]);

  if (!isVisible) return null;

  return (
    <div
      ref={containerRef}
      className={`fixed bg-gray-900 border border-gray-700 rounded-lg shadow-2xl transition-all duration-200 ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      style={{
        width: '420px',
        height: isMinimized ? '48px' : '580px',
        minHeight: isMinimized ? '48px' : '580px',
        maxHeight: '80vh',
        left: position.x,
        top: position.y,
        zIndex: 9999,
        backdropFilter: 'blur(8px)',
        background: 'rgba(17, 24, 39, 0.95)'
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-600 bg-gradient-to-r from-gray-800 to-gray-700 rounded-t-lg"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center space-x-3">
          <Tooltip
            type="quick-tip"
            content="Drag this handle to move the copilot window anywhere on screen"
            position="bottom"
          >
            <div
              className="p-2 cursor-move hover:bg-gray-600 rounded-lg transition-all duration-200 border border-gray-600"
              onMouseDown={handleMouseDown}
            >
              <GripVertical className="w-4 h-4 text-blue-400" />
            </div>
          </Tooltip>

          <Tooltip
            type="info"
            content="Proactive copilot with voice input/output and HYDI task integration"
            position="bottom"
          >
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded-lg">
              <Sparkles className="w-4 h-4 text-blue-400" />
              <span className="text-blue-100 text-sm font-semibold">Copilot</span>
              {isConnected && <CheckCircle className="w-3 h-3 text-green-400" />}
            </div>
          </Tooltip>
        </div>
        <div className="flex items-center space-x-2">
          <Tooltip
            type="quick-tip"
            content={isMinimized ? "Expand the copilot window" : "Minimize to save space"}
            position="bottom"
          >
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-2 text-gray-300 hover:bg-gray-600 rounded-lg transition-all duration-200 border border-gray-600"
            >
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
          </Tooltip>

          <Tooltip
            type="command"
            content="Close copilot (Ctrl+Shift+C to reopen)"
            position="bottom"
          >
            <button
              onClick={onClose}
              className="p-2 text-gray-300 hover:bg-red-600/20 hover:text-red-400 rounded-lg transition-all duration-200 border border-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-gray-800/50 to-gray-900/50" style={{ height: 'calc(100% - 160px)' }}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-start space-x-3 ${message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
                  }`}
              >
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${message.role === 'user'
                  ? 'bg-gradient-to-br from-blue-500 to-blue-600 border-2 border-blue-400'
                  : 'bg-gradient-to-br from-gray-600 to-gray-700 border-2 border-gray-500'
                  }`}>
                  {message.role === 'user' ? (
                    <User className="w-4 h-4 text-white" />
                  ) : (
                    <Bot className="w-4 h-4 text-blue-300" />
                  )}
                </div>
                <div className={`flex-1 max-w-full ${message.role === 'user' ? 'text-right' : ''
                  }`}>
                  {(() => {
                    const kind = message.role === 'assistant' ? getAssistantCardKind(message.content) : 'default';
                    const assistantCard = message.role === 'assistant'
                      ? `bg-gradient-to-br from-gray-700 to-gray-800 text-gray-100 border ${getAssistantCardClasses(kind)}`
                      : 'bg-gradient-to-br from-blue-600 to-blue-700 text-white border border-blue-500';
                    return (
                      <div className={`inline-block p-3 rounded-xl shadow-lg ${assistantCard}`}>
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">
                          {message.content}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="mt-2 text-xs text-gray-500 font-medium">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                  {message.role === 'assistant' && (
                    <div className="mt-3 p-2 bg-gray-800/50 rounded-lg border border-gray-700">
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
                        className="opacity-80 hover:opacity-100 transition-opacity"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 border-2 border-gray-500 flex items-center justify-center shadow-lg">
                  <Bot className="w-4 h-4 text-blue-300" />
                </div>
                <div className="flex-1">
                  <div className="inline-block p-3 rounded-xl bg-gradient-to-br from-gray-700 to-gray-800 border border-gray-600 shadow-lg">
                    <div className="flex items-center space-x-2">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                      </div>
                      <span className="text-xs text-gray-400">Thinking...</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-600 bg-gradient-to-b from-gray-800/80 to-gray-900/80">
            <div className="mb-3 flex flex-wrap gap-2">
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

            {/* Model Selector */}
            {availableModels.length > 0 && (
              <div className="mb-3 p-2 bg-gray-800/60 rounded-lg border border-gray-700">
                <div className="flex items-center space-x-3">
                  <Tooltip
                    type="info"
                    content="Select the AI model for responses. Different models excel at different tasks."
                    position="top"
                  >
                    <label className="text-xs text-blue-300 font-semibold cursor-help flex items-center">
                      <Sparkles className="w-3 h-3 mr-1" />
                      Model
                    </label>
                  </Tooltip>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  >
                    {availableModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="flex items-center space-x-3">
              <Tooltip
                type="quick-tip"
                content="Click to use voice input. Speak your question or command clearly."
                position="top"
              >
                <div className="p-2 bg-gray-800/60 rounded-lg border border-gray-700 hover:bg-gray-700/60 transition-all duration-200">
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
                      ? `What should we work on now? (using ${selectedModel})`
                      : "Waiting for connection..."
                  }
                  disabled={!isConnected || isLoading}
                  className="w-full px-4 py-2.5 bg-gray-800/60 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 text-sm pr-12 transition-all duration-200"
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
                content="Send message"
                position="top"
              >
                <button
                  onClick={sendMessage}
                  disabled={!isConnected || isLoading || !input.trim()}
                  className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-all duration-200 shadow-lg border border-blue-500/30"
                >
                  <Send className="w-4 h-4" />
                </button>
              </Tooltip>

              <Tooltip
                type="info"
                content={isAutoReadEnabled ? 'Auto-read is ON' : 'Auto-read is OFF'}
                position="top"
              >
                <button
                  onClick={() => setIsAutoReadEnabled(v => !v)}
                  className="px-3 py-2.5 bg-gray-800/60 border border-gray-700 rounded-lg text-gray-200 hover:bg-gray-700/60 transition-all duration-200"
                  title={isAutoReadEnabled ? 'Disable auto-read' : 'Enable auto-read'}
                  type="button"
                >
                  {isAutoReadEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
              </Tooltip>
            </div>

            {isConnected && (
              <div className="mt-3 p-3 bg-gray-800/40 rounded-lg border border-gray-700/50">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-400 flex items-center space-x-2">
                    <span className="flex items-center">
                      <CheckCircle className="w-3 h-3 text-green-400 mr-1" />
                      Using {selectedModel}
                    </span>
                    <span className="text-gray-500">•</span>
                    <span className="text-blue-300">Try:</span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <CommandTooltip command="what should we work on now?" description="Proactive analysis" />
                    <CommandTooltip command="plan: [objective]" description="Action planning" />
                    <CommandTooltip command="identify blockers" description="Find obstacles" />
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between pt-2 border-t border-gray-700/50">
                  <div className="flex items-center space-x-2">
                    <SuggestionTooltip suggestion="Ask me to analyze your current workflow for optimization opportunities" />
                    <QuickTipTooltip tip="Use voice input for hands-free interaction!" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
