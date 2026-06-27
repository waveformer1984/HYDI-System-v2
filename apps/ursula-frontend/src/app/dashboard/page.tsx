"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Task {
  task_id: string;
  status: string;
  verifiedStatus: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  lastVerified: string;
  crossChecks: {
    hydiStatus: string;
    ursulaStatus?: string;
    billingStatus?: string;
  };
}

interface SystemStatus {
  timestamp: string;
  totalTasks: number;
  executing: number;
  stalled: number;
  failed: number;
  completed: number;
  tasks: Task[];
  systemHealth: {
    hydiConnected: boolean;
    ursulaConnected: boolean;
    billingConnected: boolean;
    lastSync: string;
  };
}

export default function DashboardPage() {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Real-time updates every 2 seconds
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('/api/dashboard/status');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        setSystemStatus(data);
        setLastUpdate(new Date());
        setError(null);
        
        console.log(`[DASHBOARD] Status updated: ${data.executing} executing, ${data.stalled} stalled`);
        
      } catch (err) {
        console.error('[DASHBOARD] Failed to fetch status:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchStatus();

    // Set up real-time polling
    const interval = setInterval(fetchStatus, 2000);

    return () => clearInterval(interval);
  }, []);

  // Get status color based on confidence
  const getStatusColor = (status: string, confidence: string) => {
    if (confidence === 'LOW') return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    
    switch (status) {
      case 'EXECUTING':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'COMPLETED':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'FAILED':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'STALLED':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'BILLING_ISSUE':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Get confidence badge
  const getConfidenceBadge = (confidence: string) => {
    const colors = {
      HIGH: 'bg-green-500',
      MEDIUM: 'bg-yellow-500',
      LOW: 'bg-red-500',
    };
    
    return (
      <span className={`inline-block w-2 h-2 rounded-full ${colors[confidence as keyof typeof colors]} ml-2`} 
            title={`Confidence: ${confidence}`} />
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading system status...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <strong>Error:</strong> {error}
          </div>
        </div>
      </div>
    );
  }

  if (!systemStatus) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center text-gray-600">
            No system status available
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">System Status Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Real-time verified status across HYDI + Ursula + Billing
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Last updated: {lastUpdate.toLocaleTimeString()} 
            <span className="ml-2 text-green-600">Live</span>
          </p>
        </div>

        {/* System Health */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>System Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className={`text-center p-4 rounded ${
                systemStatus.systemHealth.hydiConnected ? 'bg-green-100' : 'bg-red-100'
              }`}>
                <div className={`font-semibold ${
                  systemStatus.systemHealth.hydiConnected ? 'text-green-800' : 'text-red-800'
                }`}>
                  HYDI
                </div>
                <div className="text-sm">
                  {systemStatus.systemHealth.hydiConnected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
              
              <div className={`text-center p-4 rounded ${
                systemStatus.systemHealth.ursulaConnected ? 'bg-green-100' : 'bg-red-100'
              }`}>
                <div className={`font-semibold ${
                  systemStatus.systemHealth.ursulaConnected ? 'text-green-800' : 'text-red-800'
                }`}>
                  Ursula
                </div>
                <div className="text-sm">
                  {systemStatus.systemHealth.ursulaConnected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
              
              <div className={`text-center p-4 rounded ${
                systemStatus.systemHealth.billingConnected ? 'bg-green-100' : 'bg-red-100'
              }`}>
                <div className={`font-semibold ${
                  systemStatus.systemHealth.billingConnected ? 'text-green-800' : 'text-red-800'
                }`}>
                  Billing
                </div>
                <div className="text-sm">
                  {systemStatus.systemHealth.billingConnected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="text-center p-6">
              <div className="text-2xl font-bold text-blue-600">{systemStatus.executing}</div>
              <div className="text-gray-600">Executing</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="text-center p-6">
              <div className="text-2xl font-bold text-orange-600">{systemStatus.stalled}</div>
              <div className="text-gray-600">Stalled</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="text-center p-6">
              <div className="text-2xl font-bold text-red-600">{systemStatus.failed}</div>
              <div className="text-gray-600">Failed</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="text-center p-6">
              <div className="text-2xl font-bold text-green-600">{systemStatus.completed}</div>
              <div className="text-gray-600">Completed</div>
            </CardContent>
          </Card>
        </div>

        {/* Task List */}
        <Card>
          <CardHeader>
            <CardTitle>Task Status (Verified)</CardTitle>
            <p className="text-sm text-gray-600">
              Status is cross-checked across HYDI, Ursula, and Billing systems
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {systemStatus.tasks.map((task) => (
                <div key={task.task_id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(task.verifiedStatus, task.confidence)}`}>
                        {task.verifiedStatus}
                        {getConfidenceBadge(task.confidence)}
                      </span>
                      <span className="ml-4 text-gray-600">{task.task_id}</span>
                    </div>
                    <div className="text-sm text-gray-500">
                      Verified: {new Date(task.lastVerified).toLocaleTimeString()}
                    </div>
                  </div>
                  
                  {/* Cross-check details */}
                  <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
                    <div>
                      <span className="font-medium">HYDI:</span>
                      <span className={`ml-2 px-2 py-1 rounded ${
                        task.crossChecks.hydiStatus === 'EXECUTING' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {task.crossChecks.hydiStatus}
                      </span>
                    </div>
                    
                    <div>
                      <span className="font-medium">Ursula:</span>
                      <span className={`ml-2 px-2 py-1 rounded ${
                        task.crossChecks.ursulaStatus === 'RUNNING' ? 'bg-blue-100 text-blue-800' : 
                        task.crossChecks.ursulaStatus === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                        task.crossChecks.ursulaStatus === 'FAILED' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {task.crossChecks.ursulaStatus || 'Unknown'}
                      </span>
                    </div>
                    
                    <div>
                      <span className="font-medium">Billing:</span>
                      <span className={`ml-2 px-2 py-1 rounded ${
                        task.crossChecks.billingStatus === 'succeeded' ? 'bg-green-100 text-green-800' :
                        task.crossChecks.billingStatus === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {task.crossChecks.billingStatus || 'Unknown'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
