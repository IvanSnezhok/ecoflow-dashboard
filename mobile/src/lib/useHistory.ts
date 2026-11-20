import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getRefetchIntervalMs, parseServerTimestamp, prepareChartData } from '@panel/lib/chartData';
import type { ChartPeriod, HistoryDataPoint } from '@panel/types/device';

import { api, errorMessage } from './api';

export interface History {
  period: ChartPeriod;
  /** The window the panel answered for, epoch ms */
  from: number;
  to: number;
  points: HistoryDataPoint[];
}

/**
 * A device's stored history for a period, re-read while the screen is open at the
 * pace new samples appear. The previous chart stays on screen while a period loads.
 */
export function useHistory(serialNumber: string, period: ChartPeriod) {
  const [history, setHistory] = useState<History | null>(null);
  const [failure, setFailure] = useState<{ period: ChartPeriod; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (AppState.currentState === 'background') return;
      try {
        const answer = await api.history(serialNumber, period);
        if (cancelled) return;
        setHistory({
          period,
          from: parseServerTimestamp(answer.from),
          to: parseServerTimestamp(answer.to),
          points: prepareChartData(answer.dataPoints, answer.aggregation),
        });
        setFailure(null);
      } catch (error) {
        if (!cancelled) setFailure({ period, message: errorMessage(error) });
      }
    };
    void load();
    const every = getRefetchIntervalMs(period);
    const interval = every ? setInterval(() => void load(), every) : null;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [serialNumber, period]);

  const error = failure?.period === period ? failure.message : null;
  return { history, error, loading: history?.period !== period && error === null };
}
