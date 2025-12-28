import axios from "axios";
import type {
  DeviceWithState,
  ChartPeriod,
  DateRange,
  HistoryResponse,
  ErrorHistoryResponse,
} from "@/types/device";

const client = axios.create({
  baseURL: "/api",
  timeout: 10000,
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const message = error.response.data?.message || "An error occurred";
      return Promise.reject(new Error(message));
    }
    if (error.request) {
      return Promise.reject(
        new Error("No response from server. Is the backend running?"),
      );
    }
    return Promise.reject(error);
  },
);

export const api = {
  getDevices: () => client.get<DeviceWithState[]>("/devices"),

  getDevice: (serialNumber: string) =>
    client.get<DeviceWithState>(`/devices/${serialNumber}`),

  setAcOutput: (serialNumber: string, enabled: boolean) =>
    client.post(`/devices/${serialNumber}/ac-output`, { enabled }),

  setDcOutput: (serialNumber: string, enabled: boolean) =>
    client.post(`/devices/${serialNumber}/dc-output`, { enabled }),

  setChargeLimit: (serialNumber: string, maxSoc: number, minSoc: number) =>
    client.post(`/devices/${serialNumber}/charge-limit`, { maxSoc, minSoc }),

  setMaxChargeSoc: (serialNumber: string, maxSoc: number) =>
    client.post(`/devices/${serialNumber}/max-charge-soc`, { maxSoc }),

  setMinDischargeSoc: (serialNumber: string, minSoc: number) =>
    client.post(`/devices/${serialNumber}/min-discharge-soc`, { minSoc }),

  setChargingPower: (serialNumber: string, watts: number) =>
    client.post(`/devices/${serialNumber}/charging-power`, { watts }),

  getLogs: (params?: { deviceId?: string; type?: string; limit?: number }) =>
    client.get("/logs", { params }),

  getDeviceHistory: (
    serialNumber: string,
    period: ChartPeriod,
    customRange?: DateRange
  ) =>
    client.get<HistoryResponse>(`/devices/${serialNumber}/history`, {
      params: {
        period,
        ...(customRange && { from: customRange.from, to: customRange.to }),
      },
    }),

  getDeviceErrors: (serialNumber: string, limit?: number) =>
    client.get<ErrorHistoryResponse>(`/devices/${serialNumber}/errors`, {
      params: { limit },
    }),
};
