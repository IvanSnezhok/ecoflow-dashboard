import { Column, LinearProgressIndicator, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, fillMaxWidth, height, paddingAll, width } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget, type Widget, type WidgetEnvironment } from 'expo-widgets';

import type { StationWidgetProps } from './types';

// Lower-case on purpose: this is not a React component (no hooks, runs in the widget's own runtime).
// Only the components and modifiers Android widgets support are used here.
const stationLayout = (props: StationWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme !== 'light';
  const text = dark ? '#F2F5FA' : '#0E1626';
  const muted = dark ? '#93A0B5' : '#5B667A';
  const surface = dark ? '#0B111E' : '#FFFFFF';
  const track = dark ? '#1C2638' : '#E6EBF2';
  const soc = props.soc;
  const level = soc === null ? muted : soc <= 20 ? '#F0524B' : soc <= 40 ? '#F2B233' : '#12D393';
  const gridColor = props.grid === 'off' ? '#F0524B' : props.grid === 'on' ? '#12D393' : props.grid === 'none' ? text : muted;
  const shell = [fillMaxSize(), background(surface), cornerRadius(20), paddingAll(14)];

  if (!props.name) {
    return (
      <Column modifiers={shell} verticalArrangement="center">
        <Text color={muted} style={{ fontSize: 13 }}>{props.empty}</Text>
      </Column>
    );
  }
  return (
    <Column modifiers={shell}>
      <Row modifiers={[fillMaxWidth()]} verticalAlignment="center">
        <Text color={muted} maxLines={1} style={{ fontSize: 13, fontWeight: '500' }}>{props.name}</Text>
        <Spacer modifiers={[width(8)]} />
        <Text color={muted} maxLines={1} style={{ fontSize: 11 }}>{props.updated}</Text>
      </Row>
      <Row modifiers={[fillMaxWidth()]} verticalAlignment="bottom">
        <Text color={text} maxLines={1} style={{ fontSize: 34, fontWeight: '700' }}>{soc === null ? '—' : `${Math.round(soc)}%`}</Text>
        <Spacer modifiers={[width(10)]} />
        <Column>
          <Text color={gridColor} maxLines={1} style={{ fontSize: 14, fontWeight: '600' }}>{props.gridLabel || props.status}</Text>
          <Text color={muted} maxLines={1} style={{ fontSize: 12 }}>{props.detail || (props.gridLabel ? props.status : '')}</Text>
        </Column>
      </Row>
      <Spacer modifiers={[height(8)]} />
      <LinearProgressIndicator progress={(soc ?? 0) / 100} color={level} trackColor={track} modifiers={[fillMaxWidth(), height(6)]} />
    </Column>
  );
};

const StationWidget: Widget<StationWidgetProps> | null = createWidget('StationWidget', stationLayout);
export default StationWidget;
