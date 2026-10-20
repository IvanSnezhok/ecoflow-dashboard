import type { PanelRole } from '@/types/device'

/** How each role reads in the panel (server/src/lib/permissions.ts decides) */
export const ROLE_COPY: Record<PanelRole, { label: string; description: string }> = {
  owner: {
    label: 'Owner',
    description: 'Everything, including users, automation and panel settings',
  },
  operator: {
    label: 'Operator',
    description: 'Sees the chosen devices and controls them: outputs, charge limits, charging power',
  },
  viewer: {
    label: 'Viewer',
    description: 'Sees the chosen devices: battery, power and history. Changes nothing',
  },
}

/** "All devices" or "2 devices" */
export function devicesSummary(devices: string[] | null): string {
  if (devices === null) return 'All devices'
  return devices.length === 1 ? '1 device' : `${devices.length} devices`
}
