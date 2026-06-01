import React from 'react';
import { SessionState, SystemStatus, ActionLog } from '../types/index';

interface StatusPanelProps {
  sessionState: SessionState | null;
  systemStatus: SystemStatus | null;
  actions: ActionLog[];
}

export default function StatusPanel({ sessionState, systemStatus, actions }: StatusPanelProps) {
  const getModelStatusColor = () => {
    if (!systemStatus?.model_status) return 'bg-gray-500';
    if (systemStatus.model_status.circuitBreakerActive) return 'bg-orange-500';
    if (systemStatus.model_status.consecutiveFailures > 0) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getModelStatusText = () => {
    if (!systemStatus?.model_status) return 'Unknown';
    if (systemStatus.model_status.circuitBreakerActive) return 'API Fallback Active';
    if (systemStatus.model_status.consecutiveFailures > 0) return 'Model Degraded';
    return 'Local Model Active';
  };

  return (
    <div className="bg-white border rounded-lg p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Model Status</h3>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${getModelStatusColor()}`}></div>
          <span className="text-sm text-gray-700">{getModelStatusText()}</span>
        </div>
        {systemStatus?.model_status && (
          <div className="mt-2 text-xs text-gray-500">
            <div>Failures: {systemStatus.model_status.consecutiveFailures}</div>
            {systemStatus.model_status.circuitBreakerActive && <div>Circuit breaker active</div>}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Session State</h3>
        {sessionState ? (
          <div className="text-xs text-gray-700 space-y-1">
            <div>Session ID: {sessionState.session_id}</div>
            <div>Tone: {sessionState.tone}</div>
            <div>Active Model: {sessionState.active_model}</div>
            <div>Last Action: {sessionState.last_action_status}</div>
          </div>
        ) : (
          <div className="text-xs text-gray-500">No session state</div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Action Log</h3>
        {actions && actions.length > 0 ? (
          <div className="space-y-1">
            {actions.slice(-5).map((action, index) => (
              <div key={index} className="text-xs text-gray-700 border-b pb-1">
                <div className="flex justify-between">
                  <span className="font-medium">{action.type}</span>
                  <span className={`px-1 rounded text-xs ${
                    action.status === 'completed' ? 'bg-green-100 text-green-800' :
                    action.status === 'failed' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {action.status}
                  </span>
                </div>
                <div className="text-gray-500">
                  {new Date(action.created_at).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500">No actions logged</div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">System Info</h3>
        <div className="text-xs text-gray-700 space-y-1">
          <div>Memory Connected: {systemStatus?.memory_connected ? 'Yes' : 'No'}</div>
          <div>Allowed Actions: {systemStatus?.allowed_actions?.length || 0}</div>
        </div>
      </div>
    </div>
  );
}
