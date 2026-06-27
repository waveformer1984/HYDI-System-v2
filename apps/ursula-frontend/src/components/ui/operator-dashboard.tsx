'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Settings, RefreshCw, X, AlertCircle, CheckCircle, Clock, Loader } from 'lucide-react';

interface Message {
  id: string;
  sender: 'user' | 'operator';
  content: string;
  intent?: string;
  tasks_generated?: string[];
  objective_id?: string;
  timestamp: string;
}

interface SessionStatus {
  operational: boolean;
  active_sessions: number;
}

interface TaskDetail {
  id: string;
  type: string;
  state: string;
  duration_ms: number;
  created_at: string;
}

interface ObjectiveStatus {
  objective_id: string;
  objective: string;
  status: 'in_progress' | 'completed';
  progress: number;
  progress_detail: string;
  states: Record<string, number>;
  tasks: TaskDetail[];
  eta: string;
}

export default function OperatorDashboard() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<SessionStatus>({
    operational: false,
    active_sessions: 0,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [objectiveStates, setObjectiveStates] = useState<Record<string, ObjectiveStatus>>({});
  const [expandedObjective, setExpandedObjective] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Check operator status on mount
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Poll objective status for all active objectives
  useEffect(() => {
    const objectiveIds = messages
      .filter((m) => m.objective_id)
      .map((m) => m.objective_id as string);
    const uniqueIds = [...new Set(objectiveIds)];

    if (uniqueIds.length === 0) return;

    const pollObjectives = async () => {
      for (const objId of uniqueIds) {
        try {
          const response = await fetch(
            `http://localhost:3100/api/operator/objective/${objId}/status`
          );
          if (response.ok) {
            const data = await response.json();
            setObjectiveStates((prev) => ({
              ...prev,
              [objId]: data.data,
            }));
          }
        } catch (error) {
          console.error(`Failed to poll objective ${objId}:`, error);
        }
      }
    };

    pollObjectives();
    const interval = setInterval(pollObjectives, 2000);
    return () => clearInterval(interval);
  }, [messages]);

  const checkStatus = async () => {
    try {
      const response = await fetch('http://localhost:3100/api/operator/status');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to check status:', error);
    }
  };

  const startNewSession = async () => {
    setIsLoading(true);
    try {
      // First initialize if needed
      await fetch('http://localhost:3100/api/operator/initialize', {
        method: 'POST',
      });

      // Start session
      const response = await fetch('http://localhost:3100/api/operator/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'web-user' }),
      });

      if (response.ok) {
        const data = await response.json();
        setSessionId(data.session_id);
        setMessages([
          {
            id: 'welcome',
            sender: 'operator',
            content: 'Hello! I\'m your Operator Agent. How can I help you today?',
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to start session:', error);
      alert('Failed to start session. Make sure the server is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !sessionId || isLoading) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      content: inputValue,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const messageText = inputValue;
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch(
        `http://localhost:3100/api/operator/session/${sessionId}/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: messageText }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const operatorMsg = data.message as Message;
        setMessages((prev) => [...prev, operatorMsg]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          sender: 'operator',
          content: 'Sorry, I encountered an error processing your request.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const cancelTask = async (taskId: string) => {
    try {
      const response = await fetch(`http://localhost:3100/api/operator/task/${taskId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User cancellation from dashboard' }),
      });

      if (response.ok) {
        alert(`Task ${taskId} cancelled successfully`);
      } else {
        alert('Failed to cancel task');
      }
    } catch (error) {
      console.error('Failed to cancel task:', error);
      alert('Error cancelling task');
    }
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'done':
        return 'text-green-400';
      case 'running':
        return 'text-blue-400';
      case 'failed':
        return 'text-red-400';
      case 'cancelled':
        return 'text-gray-400';
      case 'claimed':
        return 'text-yellow-400';
      default:
        return 'text-gray-300';
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'done':
        return <CheckCircle size={16} />;
      case 'running':
        return <Loader size={16} className="animate-spin" />;
      case 'failed':
        return <AlertCircle size={16} />;
      default:
        return <Clock size={16} />;
    }
  };

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="mb-8">
            <div className="inline-block p-4 bg-purple-600 rounded-full">
              <svg
                className="w-12 h-12 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M10 3a7 7 0 100 14 7 7 0 000-14zM9 10a1 1 0 112 0 1 1 0 11-2 0z" />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">HYDI Operator</h1>
          <p className="text-gray-300 mb-8">
            Your conversational AI agent for automating ProtoForge tasks
          </p>
          <button
            onClick={startNewSession}
            disabled={isLoading}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition"
          >
            {isLoading ? 'Starting...' : 'Start Conversation'}
          </button>
          <div className="mt-8 text-sm text-gray-400">
            <p>
              Status:{' '}
              <span className={status.operational ? 'text-green-400' : 'text-red-400'}>
                {status.operational ? 'Connected' : 'Initializing...'}
              </span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-purple-500/20 bg-slate-900/50 backdrop-blur p-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">HYDI Operator</h1>
            <p className="text-sm text-gray-400">Session: {sessionId.slice(0, 20)}...</p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={checkStatus}
              className="p-2 hover:bg-purple-600/20 rounded transition"
              title="Refresh status"
            >
              <RefreshCw size={20} />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-purple-600/20 rounded transition"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="bg-slate-800/50 border-b border-purple-500/10 px-4 py-2 text-sm flex gap-4">
        <div>
          Status:{' '}
          <span className={status.operational ? 'text-green-400' : 'text-yellow-400'}>
            {status.operational ? 'Ready' : 'Initializing'}
          </span>
        </div>
        <div>Sessions: {status.active_sessions}</div>
        <div>Tracking {Object.keys(objectiveStates).length} objectives</div>
      </div>

      {/* Messages + Objectives */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id}>
            {/* Message */}
            <div
              className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-sm lg:max-w-md px-4 py-3 rounded-lg ${
                  msg.sender === 'user'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-800 text-gray-100'
                }`}
              >
                <p>{msg.content}</p>
                {msg.tasks_generated && msg.tasks_generated.length > 0 && (
                  <div className="mt-2 text-sm text-gray-300">
                    <p className="font-semibold">Tasks: {msg.tasks_generated.join(', ')}</p>
                  </div>
                )}
                {msg.intent && (
                  <p className="text-xs text-gray-400 mt-1">Intent: {msg.intent}</p>
                )}
                <p className="text-xs text-gray-500 mt-1 opacity-70">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>

            {/* Objective Status (if this message has one) */}
            {msg.objective_id && objectiveStates[msg.objective_id] && (
              <div className="mt-2 ml-4">
                {(() => {
                  const objStatus = objectiveStates[msg.objective_id!];
                  return (
                    <div className="bg-slate-800/70 border border-purple-500/30 rounded-lg p-4">
                      {/* Header */}
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold text-purple-300 mb-2">
                            {objStatus.objective}
                          </h3>
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              {/* Progress Bar */}
                              <div className="bg-slate-700 rounded-full h-2 overflow-hidden">
                                <div
                                  className="bg-purple-500 h-full transition-all"
                                  style={{ width: `${objStatus.progress}%` }}
                                />
                              </div>
                              <p className="text-xs text-gray-400 mt-1">
                                {objStatus.progress_detail} ({objStatus.progress}%)
                              </p>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            setExpandedObjective(
                              expandedObjective === msg.objective_id ? null : msg.objective_id!
                            )
                          }
                          className="text-gray-400 hover:text-gray-200 ml-4"
                        >
                          {expandedObjective === msg.objective_id ? <X size={18} /> : '▼'}
                        </button>
                      </div>

                      {/* Expanded Task List */}
                      {expandedObjective === msg.objective_id && (
                        <div className="mt-4 space-y-2 border-t border-purple-500/20 pt-4">
                          {objStatus.tasks.map((task) => (
                            <div
                              key={task.id}
                              className="flex items-center justify-between text-sm bg-slate-700/50 p-2 rounded"
                            >
                              <div className="flex items-center gap-3 flex-1">
                                <div className={`${getStateColor(task.state)}`}>
                                  {getStateIcon(task.state)}
                                </div>
                                <div className="flex-1">
                                  <p className="font-medium">{task.type}</p>
                                  <p className="text-xs text-gray-400">
                                    {task.duration_ms > 0
                                      ? `${(task.duration_ms / 1000).toFixed(1)}s`
                                      : 'pending'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-semibold ${getStateColor(task.state)}`}>
                                  {task.state}
                                </span>
                                {task.state !== 'done' && task.state !== 'failed' && task.state !== 'cancelled' && (
                                  <button
                                    onClick={() => cancelTask(task.id)}
                                    className="text-red-400 hover:text-red-300 p-1"
                                    title="Cancel task"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ETA */}
                      {objStatus.status === 'in_progress' && (
                        <p className="text-xs text-gray-400 mt-3">
                          ETA: {new Date(objStatus.eta).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 text-gray-100 px-4 py-3 rounded-lg">
              <div className="flex gap-2">
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce delay-100"></div>
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-purple-500/20 bg-slate-900/50 backdrop-blur p-4">
        <form onSubmit={sendMessage} className="flex gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Tell me what you'd like to build, fix, or deploy..."
            className="flex-1 bg-slate-800 border border-purple-500/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white font-bold py-3 px-4 rounded-lg transition flex gap-2 items-center"
          >
            <Send size={18} />
          </button>
        </form>
        <p className="text-xs text-gray-500 mt-2">
          Tip: Describe what you want to accomplish and I'll track real-time progress.
        </p>
      </div>
    </div>
  );
}
