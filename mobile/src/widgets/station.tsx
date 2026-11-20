import type { Widget } from 'expo-widgets';

import type { StationWidgetProps } from './types';

// No widgets in the browser preview; station.ios.tsx and station.android.tsx hold the real ones
const StationWidget: Widget<StationWidgetProps> | null = null;
export default StationWidget;
