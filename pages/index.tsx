import { useState, useEffect } from 'react'
import Chat from '../components/Chat'
import StatusPanel from '../components/StatusPanel'
import { HeidiOrchestrator } from '../lib/orchestrator'
import type { SessionState, SystemStatus, ActionLog } from '../types/index'

export default function Home() {
  const [sessionId] = useState(`session-${Date.now()}`)
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [actions] = useState<ActionLog[]>([])

  useEffect(() => {
    const orchestrator = new HeidiOrchestrator()
    orchestrator.getSystemStatus().then(setSystemStatus)
  }, [])

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-50">
      {/* Mobile: stacked full-height chat; Desktop: side-by-side */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:gap-4 lg:p-4">
        {/* Chat — fills available height */}
        <div className="flex-1 min-h-0 bg-white lg:rounded-xl lg:shadow-sm overflow-hidden">
          <Chat sessionId={sessionId} />
        </div>

        {/* Status panel — hidden on mobile, sidebar on desktop */}
        <div className="hidden lg:block lg:w-72 flex-shrink-0">
          <StatusPanel
            sessionState={sessionState}
            systemStatus={systemStatus}
            actions={actions}
          />
        </div>
      </div>
    </div>
  )
}
