import { Routes, Route } from "react-router-dom"
import Dashboard from "../pages/Dashboard"
import Orders from "../pages/Orders"
import Smoke from "../pages/Smoke"
import Cultures from "../pages/Cultures"
import Inventory from "../pages/Inventory"
import Compliance from "../pages/Compliance"
import BottomNav from "../components/BottomNav"

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-colters-dark">

      <div className="flex-1 main-content">

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/smoke" element={<Smoke />} />
          <Route path="/cultures" element={<Cultures />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/compliance" element={<Compliance />} />
        </Routes>

      </div>

      <BottomNav />

    </div>
  )
}
