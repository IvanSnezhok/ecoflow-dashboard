import { useEffect, useState } from 'react'
import { useDeviceStore } from '@/stores/deviceStore'
import { api } from '@/services/api'

const POLLING_INTERVAL = 10000 // Server collector is authoritative; polling is a REST fallback.

let inFlight: Promise<void> | null = null
let loaded = false

/** Reads the device list once; the first answer replaces the store, later ones merge in */
export function refreshDevices(): Promise<void> {
  if (inFlight) return inFlight
  const store = useDeviceStore.getState()
  const firstLoad = !loaded
  if (firstLoad && !store.error) store.setLoading(true)
  inFlight = api.getDevices()
    .then((response) => {
      store.mergeDevicesFromServer(response.data)
      loaded = true
    })
    .catch((err) => {
      // A failed poll keeps the last data on screen; only a failed first load is shown
      if (firstLoad) store.setError(err instanceof Error ? err.message : 'Failed to fetch devices')
      console.error('Polling error:', err)
    })
    .finally(() => { inFlight = null })
  return inFlight
}

/** Polls the device list while the tab is visible (mounted once, in App) */
export function useDevices() {
  const [isTabVisible, setIsTabVisible] = useState(!document.hidden)

  useEffect(() => {
    const handleVisibilityChange = () => setIsTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Mounted after each sign-in; the first read happens even in a background tab
  useEffect(() => {
    loaded = false
    void refreshDevices()
  }, [])

  useEffect(() => {
    if (!isTabVisible) return
    void refreshDevices()
    const interval = setInterval(() => void refreshDevices(), POLLING_INTERVAL)
    return () => clearInterval(interval)
  }, [isTabVisible])
}
