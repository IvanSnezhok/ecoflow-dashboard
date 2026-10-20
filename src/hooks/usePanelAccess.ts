import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'

/**
 * The signed-in user's status; AuthGate loads it, a 401 anywhere loads it again. Read
 * again every few minutes, so a role or devices the owner changed show without a reload.
 */
export const authStatusQuery = {
  queryKey: ['authStatus'],
  queryFn: async () => (await api.getAuthStatus()).data,
  staleTime: Infinity,
  refetchInterval: 3 * 60_000,
} as const

/**
 * What the signed-in user may do (server/src/lib/permissions.ts). The server enforces
 * it; the panel only hides what would be refused.
 */
export function usePanelAccess() {
  const { data } = useQuery(authStatusQuery)
  const role = data?.role ?? null
  return {
    role,
    username: data?.username ?? null,
    devices: data?.devices ?? null,
    isOwner: role === 'owner',
    /** Outputs, charge limits and the other device commands */
    canControl: role === 'owner' || role === 'operator',
    powerReserve: data?.powerReserve ?? false,
  }
}
