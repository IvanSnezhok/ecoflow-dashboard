/**
 * What the home-screen widget shows. A widget runs outside the app and can import
 * nothing, so every text arrives ready and in the app's language (lib/widgets.ts).
 */
export interface StationWidgetProps {
  /** Station name; empty while there is nothing to show (signed out, no station) */
  name: string;
  /** Battery level in percent, null when unknown */
  soc: number | null;
  /** "Charging", "On battery", "Offline" */
  status: string;
  /** "5 h left", "1 h 20 min to full" or the power, may be empty */
  detail: string;
  grid: 'on' | 'off' | 'unknown' | 'none';
  /** "Power is on" / "No power"; empty when grid is none */
  gridLabel: string;
  /** Clock time of the reading, "14:05" */
  updated: string;
  /** Shown instead of everything else while `name` is empty */
  empty: string;
  /** Where a tap leads */
  url: string;
}

/** The outage Live Activity (iPhone): what the lock screen and the Dynamic Island show */
export interface OutageActivityProps {
  name: string;
  soc: number | null;
  /** "No power" */
  title: string;
  /** When the power went out, ms: the timer counts up from here */
  since: number;
  /** "≈ 5 h on battery", may be empty */
  reserve: string;
  /** "Power is back" once it has ended */
  ended: string;
}
