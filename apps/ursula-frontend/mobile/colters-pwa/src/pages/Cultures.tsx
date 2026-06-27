import { useState } from "react"

export default function Cultures() {
  const [cultures] = useState([
    {
      id: "CULT-001",
      name: "Sourdough Starter",
      type: "Bread Culture",
      lastCheck: "6:00 AM",
      nextCheck: "12:00 PM",
      status: "healthy",
      temperature: "78°F",
      ph: "4.2",
      notes: "Active and bubbling well"
    },
    {
      id: "CULT-002",
      name: "Kombucha SCOBY",
      type: "Fermentation",
      lastCheck: "8:00 AM",
      nextCheck: "8:00 PM",
      status: "monitoring",
      temperature: "75°F",
      ph: "3.8",
      notes: "Slow fermentation, monitor closely"
    }
  ])

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy": return "status-active"
      case "monitoring": return "status-pending"
      case "critical": return "status-alert"
      default: return "bg-gray-600"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy": return <span className="text-green-500">✓</span>
      case "monitoring": return <span className="text-yellow-500">⏰</span>
      case "critical": return <span className="text-red-500">⚠</span>
      default: return <span className="text-gray-500">🧪</span>
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6 text-colters-primary">Cultures & Fermentation</h1>

      <div className="space-y-3">
        {cultures.map((culture) => (
          <div key={culture.id} className="bg-colters-gray p-4 rounded-lg border border-gray-700">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-green-500">🧪</span>
                  <span className="font-semibold">{culture.id}</span>
                  <span className={`px-2 py-1 text-xs rounded-full text-white ${getStatusColor(culture.status)}`}>
                    {culture.status}
                  </span>
                </div>
                <h3 className="font-medium">{culture.name}</h3>
                <p className="text-sm text-gray-400">{culture.type}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-400">Last check: {culture.lastCheck}</p>
                <p className="text-sm text-colters-primary">Next: {culture.nextCheck}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-3">
              <div className="bg-black p-3 rounded">
                <p className="text-xs text-gray-400 mb-1">Temperature</p>
                <p className="text-lg font-semibold">{culture.temperature}</p>
              </div>
              <div className="bg-black p-3 rounded">
                <p className="text-xs text-gray-400 mb-1">pH Level</p>
                <p className="text-lg font-semibold">{culture.ph}</p>
              </div>
            </div>

            <div className="mb-3">
              <p className="text-sm text-gray-400">Notes: <span className="text-white">{culture.notes}</span></p>
            </div>

            <div className="flex gap-2">
              <button className="bg-colters-primary text-white px-3 py-1 rounded text-sm btn-touch">
                Log Check
              </button>
              <button className="bg-green-600 text-white px-3 py-1 rounded text-sm btn-touch">
                Update Readings
              </button>
              <button className="bg-colters-gray text-white px-3 py-1 rounded text-sm btn-touch border border-gray-600">
                View History
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Check Form */}
      <div className="mt-6 bg-colters-gray p-4 rounded-lg border border-gray-700">
        <h3 className="font-semibold mb-3">Quick Culture Check</h3>
        <div className="space-y-3">
          <select className="w-full bg-black text-white p-2 rounded border border-gray-600">
            <option>Select Culture</option>
            {cultures.map(culture => (
              <option key={culture.id}>{culture.id} - {culture.name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              placeholder="Temperature (°F)"
              className="bg-black text-white p-2 rounded border border-gray-600"
            />
            <input
              type="number"
              step="0.1"
              placeholder="pH Level"
              className="bg-black text-white p-2 rounded border border-gray-600"
            />
          </div>
          <textarea
            placeholder="Notes (optional)"
            className="w-full bg-black text-white p-2 rounded border border-gray-600 h-20"
          />
          <button className="w-full bg-colters-primary text-white p-2 rounded btn-touch">
            Record Check
          </button>
        </div>
      </div>
    </div>
  )
}
