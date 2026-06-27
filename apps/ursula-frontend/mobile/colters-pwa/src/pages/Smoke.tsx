import { useState } from "react"
import { Flame, Thermometer, Clock, CheckCircle, Plus } from "lucide-react"

export default function Smoke() {
  const [batches] = useState([
    {
      id: "BATCH-001",
      product: "Brisket",
      quantity: "15 lbs",
      startTime: "6:00 AM",
      currentTemp: "225°F",
      targetTemp: "225°F",
      stage: "smoking",
      estimatedComplete: "2:00 PM",
      woodType: "Hickory"
    },
    {
      id: "BATCH-002",
      product: "Ribs", 
      quantity: "8 racks",
      startTime: "8:00 AM",
      currentTemp: "250°F",
      targetTemp: "275°F",
      stage: "smoking",
      estimatedComplete: "12:00 PM",
      woodType: "Apple"
    }
  ])

  const getStageColor = (stage: string) => {
    switch (stage) {
      case "smoking": return "status-active"
      case "cooling": return "status-pending"
      case "completed": return "bg-gray-600"
      default: return "bg-gray-600"
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-colters-primary">Smoking Operations</h1>
        <button className="bg-colters-primary text-white p-2 rounded-lg btn-touch">
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-3">
        {batches.map((batch) => (
          <div key={batch.id} className="bg-colters-gray p-4 rounded-lg border border-gray-700">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <span className="font-semibold">{batch.id}</span>
                  <span className={`px-2 py-1 text-xs rounded-full text-white ${getStageColor(batch.stage)}`}>
                    {batch.stage}
                  </span>
                </div>
                <h3 className="font-medium">{batch.product}</h3>
                <p className="text-sm text-gray-400">{batch.quantity}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-400">Started: {batch.startTime}</p>
                <p className="text-sm text-gray-400">Est. complete: {batch.estimatedComplete}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-3">
              <div className="bg-black p-3 rounded">
                <div className="flex items-center gap-2 mb-1">
                  <Thermometer className="w-4 h-4 text-red-500" />
                  <span className="text-xs text-gray-400">Current Temp</span>
                </div>
                <p className="text-lg font-semibold">{batch.currentTemp}</p>
              </div>
              <div className="bg-black p-3 rounded">
                <div className="flex items-center gap-2 mb-1">
                  <Thermometer className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-400">Target Temp</span>
                </div>
                <p className="text-lg font-semibold">{batch.targetTemp}</p>
              </div>
            </div>

            <div className="mb-3">
              <p className="text-sm text-gray-400">Wood Type: <span className="text-white">{batch.woodType}</span></p>
            </div>

            <div className="flex gap-2">
              <button className="bg-colters-primary text-white px-3 py-1 rounded text-sm btn-touch">
                Log Temperature
              </button>
              <button className="bg-orange-600 text-white px-3 py-1 rounded text-sm btn-touch">
                Update Stage
              </button>
              <button className="bg-green-600 text-white px-3 py-1 rounded text-sm btn-touch">
                Mark Complete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Temperature Log */}
      <div className="mt-6 bg-colters-gray p-4 rounded-lg border border-gray-700">
        <h3 className="font-semibold mb-3">Quick Temperature Log</h3>
        <div className="space-y-3">
          <select className="w-full bg-black text-white p-2 rounded border border-gray-600">
            <option>Select Batch</option>
            {batches.map(batch => (
              <option key={batch.id}>{batch.id} - {batch.product}</option>
            ))}
          </select>
          <input 
            type="number" 
            placeholder="Temperature (°F)"
            className="w-full bg-black text-white p-2 rounded border border-gray-600"
          />
          <button className="w-full bg-colters-primary text-white p-2 rounded btn-touch">
            Log Temperature
          </button>
        </div>
      </div>
    </div>
  )
}
