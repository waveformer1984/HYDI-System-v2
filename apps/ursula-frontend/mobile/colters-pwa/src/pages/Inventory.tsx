import { useState } from "react"
import { Boxes, AlertTriangle, Plus, Minus } from "lucide-react"

export default function Inventory() {
  const [inventory] = useState([
    {
      id: "INV-001",
      product: "Brisket - Whole",
      category: "Beef",
      currentStock: 45,
      unit: "lbs",
      minStock: 20,
      maxStock: 100,
      status: "normal",
      lastUpdated: "2 hours ago"
    },
    {
      id: "INV-002",
      product: "Pork Ribs",
      category: "Pork", 
      currentStock: 8,
      unit: "racks",
      minStock: 15,
      maxStock: 50,
      status: "low",
      lastUpdated: "1 hour ago"
    },
    {
      id: "INV-003",
      product: "Sausage - Pork",
      category: "Pork",
      currentStock: 25,
      unit: "lbs",
      minStock: 10,
      maxStock: 60,
      status: "normal",
      lastUpdated: "30 mins ago"
    }
  ])

  const getStatusColor = (status: string) => {
    switch (status) {
      case "low": return "status-alert"
      case "normal": return "status-active"
      case "overstock": return "status-pending"
      default: return "bg-gray-600"
    }
  }

  const getStockPercentage = (current: number, max: number) => {
    return Math.round((current / max) * 100)
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6 text-colters-primary">Inventory</h1>

      {/* Low Stock Alert */}
      <div className="bg-red-900 bg-opacity-30 border border-red-600 p-3 rounded-lg mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <span className="text-red-500 font-medium">2 items low on stock</span>
        </div>
      </div>

      <div className="space-y-3">
        {inventory.map((item) => (
          <div key={item.id} className="bg-colters-gray p-4 rounded-lg border border-gray-700">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Boxes className="w-4 h-4 text-colters-primary" />
                  <span className="font-semibold">{item.id}</span>
                  <span className={`px-2 py-1 text-xs rounded-full text-white ${getStatusColor(item.status)}`}>
                    {item.status}
                  </span>
                </div>
                <h3 className="font-medium">{item.product}</h3>
                <p className="text-sm text-gray-400">{item.category}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold">{item.currentStock} {item.unit}</p>
                <p className="text-xs text-gray-400">Updated {item.lastUpdated}</p>
              </div>
            </div>

            {/* Stock Level Bar */}
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Stock Level</span>
                <span>{getStockPercentage(item.currentStock, item.maxStock)}%</span>
              </div>
              <div className="w-full bg-black rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
                    item.status === 'low' ? 'bg-red-500' : 
                    item.status === 'normal' ? 'bg-green-500' : 'bg-yellow-500'
                  }`}
                  style={{ width: `${getStockPercentage(item.currentStock, item.maxStock)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Min: {item.minStock} {item.unit}</span>
                <span>Max: {item.maxStock} {item.unit}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button className="bg-colters-primary text-white p-2 rounded btn-touch">
                <Plus className="w-4 h-4" />
              </button>
              <button className="bg-orange-600 text-white p-2 rounded btn-touch">
                <Minus className="w-4 h-4" />
              </button>
              <button className="bg-colters-gray text-white px-3 py-1 rounded text-sm btn-touch border border-gray-600">
                Record Waste
              </button>
              <button className="bg-colters-gray text-white px-3 py-1 rounded text-sm btn-touch border border-gray-600">
                View History
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Update Form */}
      <div className="mt-6 bg-colters-gray p-4 rounded-lg border border-gray-700">
        <h3 className="font-semibold mb-3">Quick Stock Update</h3>
        <div className="space-y-3">
          <select className="w-full bg-black text-white p-2 rounded border border-gray-600">
            <option>Select Product</option>
            {inventory.map(item => (
              <option key={item.id}>{item.id} - {item.product}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input 
              type="number" 
              placeholder="Quantity"
              className="bg-black text-white p-2 rounded border border-gray-600"
            />
            <select className="bg-black text-white p-2 rounded border border-gray-600">
              <option>Add Stock</option>
              <option>Remove Stock</option>
              <option>Record Waste</option>
            </select>
          </div>
          <input 
            type="text" 
            placeholder="Notes (optional)"
            className="w-full bg-black text-white p-2 rounded border border-gray-600"
          />
          <button className="w-full bg-colters-primary text-white p-2 rounded btn-touch">
            Update Inventory
          </button>
        </div>
      </div>
    </div>
  )
}
