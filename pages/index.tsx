import { useState, useEffect } from 'react'
import Chat from '../components/Chat'
import StatusPanel from '../components/StatusPanel'
import { HeidiOrchestrator } from '../lib/orchestrator'
import type { SessionState, SystemStatus, ActionLog } from '../types/index'

export default function Home() {
  const [sessionId] = useState(`session-${Date.now()}`)
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [actions, setActions] = useState<ActionLog[]>([])

  useEffect(() => {
    const orchestrator = new HeidiOrchestrator()
    orchestrator.getSystemStatus().then(setSystemStatus)
    
    const interval = setInterval(() => {
      // Poll for updates
    }, 5000)

    return () => clearInterval(interval)
  }, [sessionId])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8">
        <h1 className="text-3xl font-bold text-center mb-8">Heidi - Production Agent</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <Chat sessionId={sessionId} />
          </div>
          
          <div className="lg:col-span-1">
            <StatusPanel 
              sessionState={sessionState}
              systemStatus={systemStatus}
              actions={actions}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
