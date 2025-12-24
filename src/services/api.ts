import axios from 'axios'
import type { DeviceWithState, ChartPeriod, HistoryResponse } from '@/types/device'

const client = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const message = error.response.data?.message || 'An error occurred'
      return Promise.reject(new Error(message))
    }
    if (error.request) {
      return Promise.reject(new Error('No response from server. Is the backend running?'))
    }
    return Promise.reject(error)
  }
)

export const api = {
  getDevices: () => client.get<DeviceWithState[]>('/devices'),

  getDevice: (serialNumber: string) =>
    client.get<DeviceWithState>(`/devices/${serialNumber}`),

  setAcOutput: (serialNumber: string, enabled: boolean) =>
    client.post(`/devices/${serialNumber}/ac-output`, { enabled }),

  setDcOutput: (serialNumber: string, enabled: boolean) =>
    client.post(`/devices/${serialNumber}/dc-output`, { enabled }),

  setChargeLimit: (serialNumber: string, maxSoc: number, minSoc: number) =>
    client.post(`/devices/${serialNumber}/charge-limit`, { maxSoc, minSoc }),

  getLogs: (params?: { deviceId?: string; type?: string; limit?: number }) =>
    client.get('/logs', { params }),

  getDeviceHistory: (serialNumber: string, period: ChartPeriod) =>
    client.get<HistoryResponse>(`/devices/${serialNumber}/history`, { params: { period } }),
}
