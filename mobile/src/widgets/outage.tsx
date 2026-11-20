import type { LiveActivityFactory } from 'expo-widgets';

import type { OutageActivityProps } from './types';

// Live Activities exist only on iPhone: outage.ios.tsx
const OutageActivity: LiveActivityFactory<OutageActivityProps> | null = null;
export default OutageActivity;
