import { useSyncExternalStore } from 'react';

import { liveFieldsOf } from '@panel/lib/liveUpdate';
import { useDeviceStore } from '@panel/stores/deviceStore';
import type { DeviceState } from '@panel/types/device';

import { socketUrl } from './serverUrl';

export interface LiveStatus {
  /** The app's socket to the panel */
  connected: boolean;
  /** The panel's link to the EcoFlow MQTT broker */
  mqtt: boolean;
}

/** Must match SESSION_SUBPROTOCOL in server/src/lib/cookies.ts */
const SESSION_SUBPROTOCOL = 'ecoflow-session';
/** The panel closes a socket whose session ended with this code */
const SIGNED_OUT = 4401;
// MQTT pushes arrive several times a second; the screen takes them once a second
const FLUSH_MS = 1000;
const MAX_RETRY_MS = 30_000;

/**
 * Live device updates over the panel's /ws. The session token travels as a WebSocket
 * subprotocol, which works the same on iOS, Android and the web build.
 */
class LiveClient {
  private socket: WebSocket | null = null;
  private target: { serverUrl: string; token: string } | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, Partial<DeviceState>>();
  private status: LiveStatus = { connected: false, mqtt: false };
  private listeners = new Set<() => void>();
  onSignedOut: (() => void) | null = null;

  start(serverUrl: string, token: string): void {
    if (this.target?.serverUrl === serverUrl && this.target.token === token && this.socket) return;
    this.stop();
    this.target = { serverUrl, token };
    this.open();
  }

  stop(): void {
    this.target = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.retryTimer = this.flushTimer = null;
    this.pending.clear();
    this.attempts = 0;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus({ connected: false, mqtt: false });
  }

  private open(): void {
    const target = this.target;
    if (!target) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl(target.serverUrl), [SESSION_SUBPROTOCOL, target.token]);
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempts = 0;
      this.setStatus({ connected: true });
    };
    socket.onclose = (event) => {
      // A socket closed by stop() may report after the next one has opened
      if (this.socket !== socket) return;
      this.socket = null;
      this.setStatus({ connected: false, mqtt: false });
      if (event.code === SIGNED_OUT) {
        this.onSignedOut?.();
        return;
      }
      this.retry();
    };
    socket.onerror = () => undefined;
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      try {
        this.handle(JSON.parse(event.data) as { type?: string; data?: unknown });
      } catch {
        // Not a message of ours
      }
    };
  }

  private handle(message: { type?: string; data?: unknown }): void {
    if (message.type === 'connection') this.setStatus({ mqtt: (message.data as { mqtt?: boolean })?.mqtt === true });
    else if (message.type === 'mqttStatus') this.setStatus({ mqtt: (message.data as { connected?: boolean })?.connected === true });
    else if (message.type === 'deviceUpdate') {
      const update = message.data as { sn?: string; data?: Record<string, unknown> } | undefined;
      if (!update?.sn || !update.data) return;
      const fields = liveFieldsOf(update.data);
      if (Object.keys(fields).length === 0) return;
      this.pending.set(update.sn, { ...this.pending.get(update.sn), ...fields });
      this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
    }
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.pending.size === 0) return;
    const updates = this.pending;
    this.pending = new Map();
    // The store holds back fields with a command in flight
    useDeviceStore.getState().applyLiveUpdates(updates);
  }

  private retry(): void {
    if (!this.target || this.retryTimer) return;
    this.attempts++;
    const delay = Math.min(3000 * Math.pow(1.5, this.attempts - 1), MAX_RETRY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  getStatus = (): LiveStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setStatus(next: Partial<LiveStatus>): void {
    const status = { ...this.status, ...next };
    if (status.connected === this.status.connected && status.mqtt === this.status.mqtt) return;
    this.status = status;
    this.listeners.forEach((listener) => listener());
  }
}

export const live = new LiveClient();

export const useLiveStatus = () => useSyncExternalStore(live.subscribe, live.getStatus, live.getStatus);
