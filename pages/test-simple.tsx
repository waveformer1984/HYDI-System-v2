import { useState } from 'react'

export default function TestSimplePage() {
  const [result, setResult] = useState<Record<string,unknown>|null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const handleTest = async () => {
    setLoading(true)
    setError('')
    setResult(null)
    
    try {
      const resp = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "test-session-" + Date.now(),
          user_id: "test-user",
          actions: [{
            idempotency_key: "test-" + Date.now(),
            task_name: "echo",
            payload: { hello: "world" },
          }],
        }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(data?.error ?? `Request failed (${resp.status})`);
      }

      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-8">Heidi API Test (Simple)</h1>
        
        <button
          onClick={handleTest}
          disabled={loading}
          className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Execute API'}
        </button>

        {error && (
          <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            <strong>Error:</strong> {error}
          </div>
        )}

        {result && (
          <div className="mt-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
            <strong>Success:</strong>
            <pre className="mt-2 text-sm overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded">
          <h3 className="font-bold mb-2">Available Test Pages:</h3>
          <ul className="list-disc list-inside space-y-1">
            <li><a href="/" className="text-blue-600 hover:underline">Main Heidi Interface</a></li>
            <li><a href="/test" className="text-blue-600 hover:underline">Authentication Test</a></li>
            <li><a href="/test-simple" className="text-blue-600 hover:underline">Simple API Test</a></li>
          </ul>
        </div>
      </div>
    </div>
  )
}
