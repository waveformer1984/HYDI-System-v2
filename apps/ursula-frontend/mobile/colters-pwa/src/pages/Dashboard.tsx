import { AlertCircle, Package, Flame, Beaker, CheckSquare } from "lucide-react"

export default function Dashboard() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6 text-colters-primary">
        Colters Ops Mobile
      </h1>

      <div className="space-y-4">
        {/* Orders Due Today */}
        <div className="bg-colters-gray p-4 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-colters-primary" />
              <h2 className="font-semibold">Orders Due Today</h2>
            </div>
            <span className="bg-colters-primary text-white text-xs px-2 py-1 rounded-full">3</span>
          </div>
          <p className="text-sm text-gray-400">2 ready, 1 preparing</p>
        </div>

        {/* Active Smoking Batches */}
        <div className="bg-colters-gray p-4 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-500" />
              <h2 className="font-semibold">Active Smoking Batches</h2>
            </div>
            <span className="bg-orange-500 text-white text-xs px-2 py-1 rounded-full">2</span>
          </div>
          <p className="text-sm text-gray-400">Brisket: 4hrs, Ribs: 2hrs remaining</p>
        </div>

        {/* Cultures Check */}
        <div className="bg-colters-gray p-4 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Beaker className="w-5 h-5 text-green-500" />
              <h2 className="font-semibold">Cultures Check</h2>
            </div>
            <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full">1</span>
          </div>
          <p className="text-sm text-gray-400">Sourdough starter due in 2 hours</p>
        </div>

        {/* Compliance Alerts */}
        <div className="bg-colters-gray p-4 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <h2 className="font-semibold">Compliance Alerts</h2>
            </div>
            <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">2</span>
          </div>
          <p className="text-sm text-gray-400">Temp log overdue, HACCP checklist pending</p>
        </div>

        {/* Quick Actions */}
        <div className="mt-6">
          <h2 className="font-semibold mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <button className="bg-colters-primary text-white p-3 rounded-lg btn-touch hover:bg-red-700 transition-colors">
              Log Temperature
            </button>
            <button className="bg-colters-gray text-white p-3 rounded-lg btn-touch border border-gray-700 hover:bg-gray-600 transition-colors">
              Check Inventory
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
