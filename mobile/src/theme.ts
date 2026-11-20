import { useColorScheme } from 'react-native';

// The panel's palette (src/styles in the web app): slate surfaces, energy accents
const energy = {
  green: '#10B981',
  blue: '#3B82F6',
  yellow: '#F59E0B',
  red: '#EF4444',
  purple: '#8B5CF6',
} as const;

const dark = {
  ...energy,
  scheme: 'dark' as 'dark' | 'light',
  background: '#0B111E',
  card: '#0F172A',
  raised: '#1E293B',
  border: '#223044',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  textFaint: '#64748B',
  primary: '#12D393',
  onPrimary: '#06241A',
};

export type Theme = typeof dark;

const light: Theme = {
  ...energy,
  scheme: 'light',
  background: '#F1F5F9',
  card: '#FFFFFF',
  raised: '#E6EBF2',
  border: '#D8DFE9',
  text: '#0F172A',
  textMuted: '#64748B',
  textFaint: '#94A3B8',
  primary: '#0E9F6E',
  onPrimary: '#FFFFFF',
};

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? light : dark;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16 } as const;

/** Digits that do not shift as values change */
export const tabular = { fontVariant: ['tabular-nums' as const] };

/** A colour at the given opacity, for tinted backgrounds: tint('#10B981', 0.12) */
export function tint(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export const socColor = (theme: Theme, soc: number) => (soc <= 20 ? theme.red : soc <= 40 ? theme.yellow : theme.green);
