import { useEffect, useRef, useCallback, useState } from 'react'
import { useDeviceStore } from '@/stores/deviceStore'
import { api } from '@/services/api'

const POLLING_INTERVAL = 3000 // 3 seconds (was 1 second)

export function useDevices() {
  const {
    devices,
    isLoading,
    error,
    setDevices,
    setLoading,
    setError,
    updateDeviceFromServer
  } = useDeviceStore()
  const isFirstLoad = useRef(true)
  const [isTabVisible, setIsTabVisible] = useState(!document.hidden)

  const fetchDevices = useCallback(async () => {
    // Only show loading on first load
    if (isFirstLoad.current) {
      setLoading(true)
    }

    try {
      const response = await api.getDevices()

      if (isFirstLoad.current) {
        // First load: set all devices at once
        setDevices(response.data)
        isFirstLoad.current = false
      } else {
        // Subsequent loads: update each device (metadata + state) respecting pending commands
        for (const device of response.data) {
          updateDeviceFromServer(device)
        }
      }
    } catch (err) {
      // Only set error on first load, ignore polling errors
      if (isFirstLoad.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch devices')
      }
      console.error('Polling error:', err)
    }
  }, [setDevices, setLoading, setError, updateDeviceFromServer])

  // Track tab visibility to pause/resume polling
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(!document.hidden)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    // Initial fetch
    fetchDevices()

    // Only poll when tab is visible
    if (!isTabVisible) {
      return
    }

    // Polling every 3 seconds
    const interval = setInterval(fetchDevices, POLLING_INTERVAL)

    return () => clearInterval(interval)
  }, [fetchDevices, isTabVisible])

  return { devices, isLoading, error }
}
