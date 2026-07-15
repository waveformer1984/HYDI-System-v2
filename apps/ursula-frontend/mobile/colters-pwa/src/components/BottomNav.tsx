import { Link, useLocation } from "react-router-dom"

export default function BottomNav() {
  const location = useLocation()

  const navItems = [
    { path: "/", label: "Home", icon: "🏠" },
    { path: "/orders", label: "Orders", icon: "📦" },
    { path: "/smoke", label: "Smoke", icon: "🔥" },
    { path: "/cultures", label: "Cultures", icon: "🧪" },
    { path: "/inventory", label: "Inventory", icon: "📋" },
    { path: "/compliance", label: "Compliance", icon: "📋" }
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-colters-gray border-t border-gray-700 flex justify-around p-2 z-50">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path

        return (
          <Link
            to={item.path}
            className={`flex flex-col items-center p-2 rounded-lg transition-colors btn-touch ${isActive
                ? 'text-colters-primary'
                : 'text-gray-400 hover:text-white'
              }`}
          >
            <span className="text-xl mb-1">{item.icon}</span>
            <span className="text-xs">{item.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
