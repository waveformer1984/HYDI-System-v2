import { useState } from "react"

export default function Compliance() {
  const [checklists] = useState([
    {
      id: "COMP-001",
      name: "Daily HACCP Temperature Log",
      type: "Daily",
      dueTime: "11:00 AM",
      status: "overdue",
      items: [
        { task: "Check smoker #1 temperature", completed: false },
        { task: "Check smoker #2 temperature", completed: false },
        { task: "Log walk-in cooler temp", completed: true },
        { task: "Log walk-in freezer temp", completed: true }
      ]
    },
    {
      id: "COMP-002",
      name: "Weekly Equipment Sanitization",
      type: "Weekly",
      dueTime: "Friday 4:00 PM",
      status: "pending",
      items: [
        { task: "Sanitize smoker #1", completed: false },
        { task: "Sanitize smoker #2", completed: false },
        { task: "Clean prep surfaces", completed: false },
        { task: "Check chemical labels", completed: true }
      ]
    },
    {
      id: "COMP-003",
      name: "Monthly Pest Control Inspection",
      type: "Monthly",
      dueTime: "March 15",
      status: "completed",
      items: [
        { task: "Check traps", completed: true },
        { task: "Inspect entry points", completed: true },
        { task: "Review logbook", completed: true },
        { task: "Schedule service", completed: true }
      ]
    }
  ])

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "status-active"
      case "pending": return "status-pending"
      case "overdue": return "status-alert"
      default: return "bg-gray-600"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <span className="text-green-500">✓</span>
      case "pending": return <span className="text-yellow-500">⏰</span>
      case "overdue": return <span className="text-red-500">⚠</span>
      default: return <span className="text-gray-500">📋</span>
    }
  }

  const getCompletionPercentage = (items: any[]) => {
    const completed = items.filter(item => item.completed).length
    return Math.round((completed / items.length) * 100)
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6 text-colters-primary">Compliance</h1>

      {/* Overdue Alert */}
      <div className="bg-red-900 bg-opacity-30 border border-red-600 p-3 rounded-lg mb-4">
        <div className="flex items-center gap-2">
          <span className="text-red-500">⚠</span>
          <span className="text-red-500 font-medium">1 compliance item overdue</span>
        </div>
      </div>

      <div className="space-y-3">
        {checklists.map((checklist) => (
          <div key={checklist.id} className="bg-colters-gray p-4 rounded-lg border border-gray-700">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-colters-primary">📋</span>
                  <span className="font-semibold">{checklist.id}</span>
                  <span className={`px-2 py-1 text-xs rounded-full text-white ${getStatusColor(checklist.status)}`}>
                    {checklist.status}
                  </span>
                </div>
                <h3 className="font-medium">{checklist.name}</h3>
                <p className="text-sm text-gray-400">{checklist.type} • Due: {checklist.dueTime}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold">{getCompletionPercentage(checklist.items)}%</p>
                <p className="text-xs text-gray-400">Complete</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-3">
              <div className="w-full bg-black rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${checklist.status === 'completed' ? 'bg-green-500' :
                    checklist.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                  style={{ width: `${getCompletionPercentage(checklist.items)}%` }}
                />
              </div>
            </div>

            {/* Checklist Items */}
            <div className="mb-3">
              <p className="text-sm text-gray-400 mb-2">Items:</p>
              <div className="space-y-1">
                {checklist.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <div className={`w-4 h-4 rounded border ${item.completed
                      ? 'bg-green-500 border-green-500'
                      : 'border-gray-600'
                      }`}>
                      {item.completed && (
                        <span className="text-white text-xs">✓</span>
                      )}
                    </div>
                    <span className={item.completed ? 'text-gray-400' : 'text-white'}>
                      {item.task}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              {checklist.status !== "completed" && (
                <button className="bg-colters-primary text-white px-3 py-1 rounded text-sm btn-touch">
                  Continue Checklist
                </button>
              )}
              <button className="bg-colters-gray text-white px-3 py-1 rounded text-sm btn-touch border border-gray-600">
                View Details
              </button>
              <button className="bg-colters-gray text-white p-1 rounded btn-touch border border-gray-600">
                <span className="text-white">📄</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Action Buttons */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button className="bg-colters-primary text-white p-3 rounded-lg btn-touch">
          Log Temperature
        </button>
        <button className="bg-colters-gray text-white p-3 rounded-lg btn-touch border border-gray-700">
          Start Checklist
        </button>
      </div>
    </div>
  )
}
