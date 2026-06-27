import { useState, useEffect } from 'react'
import Chat from '../components/Chat'
import StatusPanel from '../components/StatusPanel'

export default function Home() {
  const [sessionId] = useState(`session-${Date.now()}`)
  const [sessionState, setSessionState] = useState(null)
  const [systemStatus, setSystemStatus] = useState<any>(null)
  const [actions, setActions] = useState([])

  useEffect(() => {
    let cancelled = false

    // Fetch system status from the server. The orchestrator is server-side code
    // (it needs SUPABASE_SERVICE_ROLE_KEY) and must never be instantiated in the
    // browser — do it behind the API route instead.
    const loadStatus = () => {
      fetch('/api/heidi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data) return
          setSystemStatus({
            model_status: {
              consecutiveFailures: 0,
              circuitBreakerActive: !data.available,
            },
            memory_connected: !!data.available,
            allowed_actions: [],
          })
        })
        .catch(() => {
          // Status is optional; StatusPanel renders safe defaults if it's null.
        })
    }

    loadStatus()
    const interval = setInterval(loadStatus, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [sessionId])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Heidi - Production Agent</h1>
          <a
            href="/funding"
            className="text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-4 py-2 hover:bg-blue-50 transition-colors"
          >
            Z-Labs Funding →
          </a>
        </div>
        
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
