'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Message {
  id: string;
  role: 'user' | 'hydi';
  content: string;
  timestamp: Date;
}

interface HYDIChatProps {
  className?: string;
}

export function HYDIChat({ className }: HYDIChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'hydi',
      content: 'Hello! I\'m HYDI, your automated assistant. I can help with:\n\n• Payment processing setup\n• Code analysis and reviews\n• Documentation updates\n• Task automation\n• System monitoring\n\nWhat would you like to work on today?',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const traceId =
        typeof globalThis.crypto !== 'undefined' &&
        typeof globalThis.crypto.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setLastTraceId(traceId);
      // Call HYDI API
      const response = await fetch('/api/hydi/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': traceId,
        },
        body: JSON.stringify({
          message: input,
          context: {
            user: 'jordan',
            system: 'ursula',
            capabilities: ['payment-processing', 'code-analysis', 'documentation', 'automation'],
          },
        }),
      });

      const data = await response.json();
      if (typeof data?.traceId === 'string') {
        setLastTraceId(data.traceId);
      }

      const hydiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'hydi',
        content: data.response || 'I encountered an error processing your request.',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, hydiMessage]);
    } catch (error) {
      // Fallback response if API is not available
      const fallbackMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'hydi',
        content: `I understand you want help with: "${input}". \n\nI\'m currently connecting to my task processing system. In the meantime, I can:\n\n• Create payment links for your services\n• Analyze your codebase for issues\n• Update documentation\n• Set up automation workflows\n\nWhich of these would you like to explore?`,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, fallbackMessage]);
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
    <Card className={`flex flex-col h-[600px] ${className}`}>
      <div className="flex items-center gap-2 p-4 border-b">
        <Bot className="w-5 h-5 text-blue-500" />
        <h3 className="font-semibold">HYDI Assistant</h3>
        <div className="ml-auto flex items-center gap-2">
          {lastTraceId && (
            <span className="text-[10px] font-mono text-muted-foreground">
              trace: {lastTraceId.slice(0, 12)}...
            </span>
          )}
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-sm text-muted-foreground">Online</span>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.role === 'hydi' && (
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white ml-auto'
                    : 'bg-muted text-foreground'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                <p className="text-xs opacity-70 mt-1">
                  {message.timestamp.toLocaleTimeString()}
                </p>
              </div>

              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          ))}
          
          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-muted rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">HYDI is thinking...</span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask HYDI about payment processing, code analysis, or automation..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={isLoading || !input.trim()}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        
        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInput('Create a payment link for my consulting service')}
            disabled={isLoading}
          >
            Payment Link
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInput('Analyze my codebase for security issues')}
            disabled={isLoading}
          >
            Security Scan
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInput('Update my API documentation')}
            disabled={isLoading}
          >
            Update Docs
          </Button>
        </div>
      </div>
    </Card>
  );
}
