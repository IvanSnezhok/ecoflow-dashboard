import { config } from '../config/env.js'
import { generateSignature } from './signatureService.js'

interface ApiResponse<T> {
  code: string
  message: string
  data: T
}

interface DeviceListItem {
  sn: string
  deviceName: string
  online: number
  productName: string
}

interface DeviceQuota {
  soc: number
  wattsInSum: number
  wattsOutSum: number
  [key: string]: unknown
}

class EcoflowApiClient {
  private baseUrl: string
  private accessKey: string
  private secretKey: string

  constructor() {
    this.baseUrl = config.ecoflow.apiEndpoint
    this.accessKey = config.ecoflow.accessKey
    this.secretKey = config.ecoflow.secretKey
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    params: Record<string, string | number | boolean> = {},
    body?: unknown
  ): Promise<T> {
    // Note: For GET requests, params are passed in URL but NOT included in signature
    const { headers } = generateSignature({
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      params: {}, // Params are not signed for Ecoflow API
    })

    const url = new URL(path, this.baseUrl)
    if (method === 'GET') {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value))
      })
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      throw new Error(`Ecoflow API error: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as ApiResponse<T>

    if (data.code !== '0') {
      throw new Error(`Ecoflow API error (code ${data.code}): ${data.message}`)
    }

    if (data.data === undefined || data.data === null) {
      throw new Error('Ecoflow API returned empty data')
    }

    return data.data
  }

  async getDeviceList(): Promise<DeviceListItem[]> {
    return this.request<DeviceListItem[]>('GET', '/iot-open/sign/device/list')
  }

  async getDeviceQuota(sn: string): Promise<DeviceQuota> {
    return this.request<DeviceQuota>('GET', '/iot-open/sign/device/quota/all', { sn })
  }

  async setDeviceFunction(sn: string, cmdCode: string, params: Record<string, unknown>): Promise<void> {
    await this.request('PUT', '/iot-open/sign/device/quota', {}, {
      sn,
      cmdCode,
      params,
    })
  }

  // Specific device control methods
  async setAcOutput(sn: string, enabled: boolean): Promise<void> {
    await this.setDeviceFunction(sn, 'WN511_SET_AC_OUT', {
      out_freq: 1, // 50Hz
      out_voltage: 220,
      xboost: 0,
      enabled: enabled ? 1 : 0,
    })
  }

  async setDcOutput(sn: string, enabled: boolean): Promise<void> {
    await this.setDeviceFunction(sn, 'WN511_SET_DC_OUT', {
      enabled: enabled ? 1 : 0,
    })
  }

  async setChargeLimit(sn: string, maxSoc: number, minSoc: number): Promise<void> {
    await this.setDeviceFunction(sn, 'WN511_SET_SOC', {
      maxChgSoc: maxSoc,
      minDsgSoc: minSoc,
    })
  }

  // Get MQTT credentials for real-time updates
  async getMqttCredentials(): Promise<{
    url: string
    port: number
    protocol: string
    certificateAccount: string
    certificatePassword: string
  }> {
    return this.request('GET', '/iot-open/sign/certification')
  }
}

export const ecoflowApi = new EcoflowApiClient()
