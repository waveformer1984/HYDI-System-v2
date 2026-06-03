import axios from "axios"

const api = axios.create({
  baseURL: "http://localhost:5055", // Ursula backend
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  }
})

// Request interceptor for auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Dashboard API
export const getDashboard = () =>
  api.get("/api/mobile/dashboard/today")

// Orders API
export const getOrders = (params?: { status?: string; limit?: number }) =>
  api.get("/api/mobile/orders", { params })

export const getOrder = (id: string) =>
  api.get(`/api/mobile/orders/${id}`)

export const updateOrder = (id: string, data: { status?: string; notes?: string }) =>
  api.patch(`/api/mobile/orders/${id}`, data)

export const completeOrder = (id: string, data: { handoffNotes?: string; pickupConfirmed?: boolean }) =>
  api.post(`/api/mobile/orders/${id}/complete`, data)

// Smoking Operations API
export const getSmokingBatches = () =>
  api.get("/api/mobile/smoke/batches")

export const getBatch = (id: string) =>
  api.get(`/api/mobile/smoke/batches/${id}`)

export const updateBatch = (id: string, data: { 
  temperature?: number; 
  stage?: string; 
  notes?: string; 
  woodAdded?: boolean 
}) =>
  api.patch(`/api/mobile/smoke/batches/${id}`, data)

export const completeBatch = (id: string, data: { finalWeight?: number; notes?: string }) =>
  api.post(`/api/mobile/smoke/batches/${id}/complete`, data)

// Culture Management API
export const getCultures = () =>
  api.get("/api/mobile/cultures")

export const getCulture = (id: string) =>
  api.get(`/api/mobile/cultures/${id}`)

export const updateCulture = (id: string, data: { 
  temperature?: number; 
  ph?: number; 
  notes?: string; 
  nextCheck?: string 
}) =>
  api.patch(`/api/mobile/cultures/${id}`, data)

export const recordCultureCheck = (id: string, data: {
  temperature: number;
  ph: number;
  notes?: string;
  checkTime: string;
}) =>
  api.post(`/api/mobile/cultures/${id}/check`, data)

// Inventory API
export const getInventory = (params?: { lowStock?: boolean; category?: string }) =>
  api.get("/api/mobile/inventory", { params })

export const updateInventory = (id: string, data: { 
  quantity: number; 
  operation: 'add' | 'remove' | 'waste'; 
  notes?: string 
}) =>
  api.patch(`/api/mobile/inventory/${id}`, data)

export const recordWaste = (data: { 
  productId: string; 
  quantity: number; 
  reason: string; 
  notes?: string 
}) =>
  api.post("/api/mobile/inventory/waste", data)

// Compliance API
export const getComplianceItems = () =>
  api.get("/api/mobile/compliance")

export const getChecklist = (id: string) =>
  api.get(`/api/mobile/compliance/checklist/${id}`)

export const updateChecklist = (id: string, data: { 
  itemId: string; 
  completed: boolean; 
  notes?: string 
}) =>
  api.patch(`/api/mobile/compliance/checklist/${id}`, data)

export const recordComplianceCheck = (data: {
  checklistId: string;
  temperature: number;
  passed: boolean;
  notes?: string;
  correctiveAction?: string;
}) =>
  api.post("/api/mobile/compliance/check", data)

// Logging API
export const logTemperature = (data: {
  batchId?: string;
  location: string;
  temperature: number;
  notes?: string;
}) =>
  api.post("/api/mobile/logs/temp", data)

export const logActivity = (data: {
  action: string;
  entityType: string;
  entityId: string;
  notes?: string;
}) =>
  api.post("/api/mobile/logs/activity", data)

// Alerts API
export const getAlerts = (params?: { type?: string; resolved?: boolean }) =>
  api.get("/api/mobile/alerts", { params })

export const dismissAlert = (id: string) =>
  api.post(`/api/mobile/alerts/${id}/dismiss`)

export const acknowledgeAlert = (id: string) =>
  api.post(`/api/mobile/alerts/${id}/acknowledge`)

// Auth API
export const login = (credentials: { email: string; password: string }) =>
  api.post("/api/auth/login", credentials)

export const logout = () =>
  api.post("/api/auth/logout")

export const refreshToken = () =>
  api.post("/api/auth/refresh")

export default api
