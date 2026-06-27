import { create } from "zustand"

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'production' | 'fulfillment' | 'compliance'
  permissions: string[]
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  setRole: (role: string) => void
  hasPermission: (permission: string) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (email: string, password: string) => {
    set({ isLoading: true })
    try {
      // Mock login - replace with actual API call
      const mockUser: User = {
        id: "user-001",
        name: "John Operator",
        email: email,
        role: "production",
        permissions: ["orders:read", "orders:update", "smoke:read", "smoke:update", "cultures:read", "cultures:update"]
      }
      
      const mockToken = "mock-jwt-token"
      
      localStorage.setItem('auth_token', mockToken)
      
      set({
        user: mockUser,
        token: mockToken,
        isAuthenticated: true,
        isLoading: false
      })
    } catch (error) {
      set({ isLoading: false })
      throw error
    }
  },

  logout: () => {
    localStorage.removeItem('auth_token')
    set({
      user: null,
      token: null,
      isAuthenticated: false
    })
  },

  setRole: (role: string) => {
    const currentUser = get().user
    if (currentUser) {
      const updatedUser = { ...currentUser, role: role as any }
      set({ user: updatedUser })
    }
  },

  hasPermission: (permission: string) => {
    const user = get().user
    return user?.permissions.includes(permission) || false
  }
}))

// Role-based access control helper
export const rolePermissions = {
  admin: [
    "orders:read", "orders:update", "orders:delete",
    "smoke:read", "smoke:update", "smoke:delete", 
    "cultures:read", "cultures:update", "cultures:delete",
    "inventory:read", "inventory:update", "inventory:delete",
    "compliance:read", "compliance:update", "compliance:delete",
    "users:read", "users:update", "users:delete",
    "reports:read", "system:configure"
  ],
  production: [
    "orders:read", "orders:update",
    "smoke:read", "smoke:update",
    "cultures:read", "cultures:update",
    "inventory:read", "inventory:update",
    "compliance:read", "compliance:update"
  ],
  fulfillment: [
    "orders:read", "orders:update",
    "inventory:read",
    "compliance:read"
  ],
  compliance: [
    "orders:read",
    "smoke:read",
    "cultures:read",
    "inventory:read",
    "compliance:read", "compliance:update"
  ]
}

export const getPermissionsForRole = (role: string): string[] => {
  return rolePermissions[role as keyof typeof rolePermissions] || []
}
