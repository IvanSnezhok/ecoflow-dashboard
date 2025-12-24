import { useEffect, useState } from 'react'
import { wsClient } from '@/services/wsClient'

interface MqttStatus {
  wsConnected: boolean
  mqttConnected: boolean
}

export function useMqtt() {
  const [status, setStatus] = useState<MqttStatus>({
    wsConnected: false,
    mqttConnected: false,
  })

  useEffect(() => {
    const handleConnected = () => {
      setStatus((prev) => ({ ...prev, wsConnected: true }))
    }

    const handleDisconnected = () => {
      setStatus({ wsConnected: false, mqttConnected: false })
    }

    const handleMqttStatus = (data: unknown) => {
      const mqttData = data as { connected: boolean }
      setStatus((prev) => ({ ...prev, mqttConnected: mqttData.connected }))
    }

    const handleConnection = (data: unknown) => {
      const connData = data as { mqtt: boolean }
      setStatus((prev) => ({ ...prev, mqttConnected: connData.mqtt }))
    }

    wsClient.on('connected', handleConnected)
    wsClient.on('disconnected', handleDisconnected)
    wsClient.on('mqttStatus', handleMqttStatus)
    wsClient.on('connection', handleConnection)

    // Connect on mount
    wsClient.connect()

    return () => {
      wsClient.off('connected', handleConnected)
      wsClient.off('disconnected', handleDisconnected)
      wsClient.off('mqttStatus', handleMqttStatus)
      wsClient.off('connection', handleConnection)
    }
  }, [])

  return status
}
