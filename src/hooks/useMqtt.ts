import { useEffect, useSyncExternalStore } from 'react'
import { wsClient, type LiveStatus } from '@/services/wsClient'

/** Live-update status shared by every component (the drawer opened later sees it too) */
export function useMqtt(): LiveStatus {
  useEffect(() => {
    wsClient.connect()
  }, [])
  return useSyncExternalStore(wsClient.subscribeStatus, wsClient.getStatus)
}
