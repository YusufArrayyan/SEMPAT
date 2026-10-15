import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { api, ApiError } from './api'
import type { Role, User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  can: (min: Role) => boolean
  refresh: () => void
}

const RANK: Record<Role, number> = { peneliti: 1, analis: 2, admin: 3 }
const Ctx = createContext<AuthState>({ user: null, loading: true, can: () => false, refresh: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.get<{ user: User }>('/me')).user
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 60_000,
    retry: false,
  })
  const user = q.data ?? null
  return (
    <Ctx.Provider
      value={{
        user,
        loading: q.isLoading,
        can: (min) => !!user && RANK[user.role] >= RANK[min],
        refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)
export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', analis: 'Analis', peneliti: 'Peneliti' }
