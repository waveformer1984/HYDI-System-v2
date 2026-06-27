'use client';

import { useState, useEffect } from 'react';
import { Bot, Bell, AlertTriangle, CheckCircle, Clock, Zap, Target, ListTodo } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface TaskAlert {
  id: string;
  type: 'urgent' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  assignee: 'jordan' | 'hydi' | 'agent';
  category: 'concept' | 'scaffolded' | 'built';
  estimatedTime: string;
  dueDate?: string;
}

interface UrsulaBotProps {
  className?: string;
}

export default function UrsulaBot({ className }: UrsulaBotProps) {
  const [alerts, setAlerts] = useState<TaskAlert[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScan, setLastScan] = useState<Date>(new Date());

  // Simulate task analysis and alert generation
  useEffect(() => {
    const analyzeTasks = () => {
      setIsProcessing(true);
      
      // Simulate scanning inventory and generating alerts
      const mockAlerts: TaskAlert[] = [
        {
          id: '1',
          type: 'urgent',
          title: 'GitBuddy: Technical Specification Needed',
          description: 'Define core features and architecture for Git workflow assistant',
          assignee: 'jordan',
          category: 'concept',
          estimatedTime: '2 hours',
          dueDate: 'Today',
        },
        {
          id: '2',
          type: 'high',
          title: 'Z-AERO: LLC Formation Required',
          description: 'Complete business formation for EV motorcycle venture',
          assignee: 'jordan',
          category: 'concept',
          estimatedTime: '8 hours',
          dueDate: 'This Week',
        },
        {
          id: '3',
          type: 'medium',
          title: 'Payment Links: Share with Clients',
          description: '3 payment links ready ($50, $100, $150) - need distribution',
          assignee: 'hydi',
          category: 'built',
          estimatedTime: '30 minutes',
        },
        {
          id: '4',
          type: 'high',
          title: 'Fiverr Gig 4: Publish Payment Processing Setup',
          description: '$500-3,500 service ready to publish on Fiverr',
          assignee: 'jordan',
          category: 'built',
          estimatedTime: '1 hour',
        },
        {
          id: '5',
          type: 'medium',
          title: 'Upwork Applications: 5 Jobs Available',
          description: 'Payment processing jobs ready for PaaS proposals',
          assignee: 'hydi',
          category: 'built',
          estimatedTime: '2 hours',
        },
      ];

      setTimeout(() => {
        setAlerts(mockAlerts);
        setIsProcessing(false);
        setLastScan(new Date());
      }, 1500);
    };

    analyzeTasks();
    
    // Re-scan every 5 minutes
    const interval = setInterval(analyzeTasks, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const getTypeColor = (type: TaskAlert['type']) => {
    switch (type) {
      case 'urgent': return 'text-red-500 bg-red-50 border-red-200';
      case 'high': return 'text-orange-500 bg-orange-50 border-orange-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-blue-500 bg-blue-50 border-blue-200';
    }
  };

  const getTypeIcon = (type: TaskAlert['type']) => {
    switch (type) {
      case 'urgent': return AlertTriangle;
      case 'high': return Zap;
      case 'medium': return Clock;
      case 'low': return CheckCircle;
    }
  };

  const getAssigneeColor = (assignee: TaskAlert['assignee']) => {
    switch (assignee) {
      case 'jordan': return 'bg-purple-100 text-purple-700';
      case 'hydi': return 'bg-blue-100 text-blue-700';
      case 'agent': return 'bg-green-100 text-green-700';
    }
  };

  const categoryStats = {
    concept: alerts.filter(a => a.category === 'concept').length,
    scaffolded: alerts.filter(a => a.category === 'scaffolded').length,
    built: alerts.filter(a => a.category === 'built').length,
  };

  const assigneeStats = {
    jordan: alerts.filter(a => a.assignee === 'jordan').length,
    hydi: alerts.filter(a => a.assignee === 'hydi').length,
    agent: alerts.filter(a => a.assignee === 'agent').length,
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold text-lg">Ursula Task Assistant</h3>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
            <span className="text-xs text-muted-foreground">
              {isProcessing ? 'Scanning...' : 'Active'}
            </span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Last scan: {lastScan.toLocaleTimeString()}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <ListTodo className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium">By Status</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span>Concepts:</span>
              <span className="font-mono bg-blue-100 px-1 rounded">{categoryStats.concept}</span>
            </div>
            <div className="flex justify-between">
              <span>Scaffolded:</span>
              <span className="font-mono bg-yellow-100 px-1 rounded">{categoryStats.scaffolded}</span>
            </div>
            <div className="flex justify-between">
              <span>Built:</span>
              <span className="font-mono bg-green-100 px-1 rounded">{categoryStats.built}</span>
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium">By Assignee</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span>Jordan:</span>
              <span className={`font-mono px-1 rounded ${getAssigneeColor('jordan')}`}>
                {assigneeStats.jordan}
              </span>
            </div>
            <div className="flex justify-between">
              <span>HYDI:</span>
              <span className={`font-mono px-1 rounded ${getAssigneeColor('hydi')}`}>
                {assigneeStats.hydi}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Agent:</span>
              <span className={`font-mono px-1 rounded ${getAssigneeColor('agent')}`}>
                {assigneeStats.agent}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Alerts */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-medium">Task Alerts ({alerts.length})</span>
        </div>

        {isProcessing ? (
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">Analyzing inventory and generating alerts...</span>
            </div>
          </Card>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {alerts.map((alert) => {
              const Icon = getTypeIcon(alert.type);
              return (
                <Card key={alert.id} className={`p-3 border-l-4 ${getTypeColor(alert.type)}`}>
                  <div className="flex items-start gap-3">
                    <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-medium truncate">{alert.title}</h4>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${getAssigneeColor(alert.assignee)}`}>
                          {alert.assignee}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{alert.description}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{alert.estimatedTime}</span>
                        {alert.dueDate && <span>• Due: {alert.dueDate}</span>}
                        <span>• {alert.category}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button className="flex-1 px-3 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-colors">
          Assign to HYDI
        </button>
        <button className="flex-1 px-3 py-2 bg-purple-500 text-white rounded text-sm hover:bg-purple-600 transition-colors">
          View Details
        </button>
      </div>
    </div>
  );
}
