import { useState } from "react"
import { Package, Clock, CheckCircle, User, Phone } from "lucide-react"

export default function Orders() {
  const [orders] = useState([
    {
      id: "ORD-001",
      customer: "John's Restaurant",
      items: ["Brisket 5lbs", "Ribs 3lbs"],
      status: "ready",
      time: "2:30 PM",
      phone: "555-0123"
    },
    {
      id: "ORD-002", 
      customer: "Sarah's Catering",
      items: ["Pulled Pork 8lbs", "Sausage 4lbs"],
      status: "preparing",
      time: "3:45 PM",
      phone: "555-0456"
    },
    {
      id: "ORD-003",
      customer: "Mike's BBQ",
      items: ["Brisket 10lbs"],
      status: "ready", 
      time: "4:00 PM",
      phone: "555-0789"
    }
  ])

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready": return "status-active"
      case "preparing": return "status-pending"
      case "completed": return "bg-gray-600"
      default: return "bg-gray-600"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "ready": return <CheckCircle className="w-4 h-4" />
      case "preparing": return <Clock className="w-4 h-4" />
      default: return <Package className="w-4 h-4" />
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6 text-colters-primary">Orders</h1>

      <div className="space-y-3">
        {orders.map((order) => (
          <div key={order.id} className="bg-colters-gray p-4 rounded-lg border border-gray-700">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-colters-primary" />
                  <span className="font-semibold">{order.id}</span>
                  <span className={`px-2 py-1 text-xs rounded-full text-white ${getStatusColor(order.status)}`}>
                    {order.status}
                  </span>
                </div>
                <h3 className="font-medium">{order.customer}</h3>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-400">{order.time}</p>
                <div className="flex items-center gap-1 text-gray-400">
                  <Phone className="w-3 h-3" />
                  <span className="text-xs">{order.phone}</span>
                </div>
              </div>
            </div>

            <div className="mb-3">
              <p className="text-sm text-gray-400 mb-1">Items:</p>
              <div className="space-y-1">
                {order.items.map((item, idx) => (
                  <p key={idx} className="text-sm">• {item}</p>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              {order.status === "preparing" && (
                <button className="bg-colters-primary text-white px-3 py-1 rounded text-sm btn-touch">
                  Mark Ready
                </button>
              )}
              {order.status === "ready" && (
                <button className="bg-green-600 text-white px-3 py-1 rounded text-sm btn-touch">
                  Complete Order
                </button>
              )}
              <button className="bg-colters-gray text-white px-3 py-1 rounded text-sm btn-touch border border-gray-600">
                View Details
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
