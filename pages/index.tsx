import { useState, useEffect } from 'react'
import Chat from '../components/Chat'
import StatusPanel from '../components/StatusPanel'
import { HeidiOrchestrator } from '../lib/orchestrator'

export default function Home() {
  const [sessionId] = useState(`session-${Date.now()}`)
  const [sessionState, setSessionState] = useState(null)
  const [systemStatus, setSystemStatus] = useState<any>(null)
  const [actions, setActions] = useState([])

  useEffect(() => {
    // Initialize system status
    const orchestrator = new HeidiOrchestrator()
    orchestrator.getSystemStatus().then(setSystemStatus)
    
    // Set up polling for session state
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
          {/* Main Chat Interface */}
          <div className="lg:col-span-3">
            <Chat sessionId={sessionId} />
          </div>
          
          {/* Status Panel */}
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
