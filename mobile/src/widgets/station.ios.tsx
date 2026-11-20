import { Gauge, HStack, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, gaugeStyle, lineLimit, minimumScaleFactor, monospacedDigit, tint, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type Widget, type WidgetEnvironment } from 'expo-widgets';

import type { StationWidgetProps } from './types';

// Lower-case on purpose: this is not a React component (no hooks, runs in the widget's own runtime)
const stationLayout = (props: StationWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme !== 'light';
  const family = environment.widgetFamily ?? 'systemSmall';
  const lockScreen = family.startsWith('accessory');
  const text = dark ? '#F2F5FA' : '#0E1626';
  const muted = dark ? '#93A0B5' : '#5B667A';
  const background = dark ? '#0B111E' : '#FFFFFF';
  const soc = props.soc;
  const level = soc === null ? muted : soc <= 20 ? '#F0524B' : soc <= 40 ? '#F2B233' : '#12D393';
  const gridColor = props.grid === 'off' ? '#F0524B' : props.grid === 'on' ? '#12D393' : muted;
  const percent = soc === null ? '—' : `${Math.round(soc)}%`;
  const shell = [containerBackground(background, 'widget'), widgetURL(props.url)];

  if (family === 'accessoryCircular') {
    return (
      <Gauge value={soc ?? 0} min={0} max={100} modifiers={[gaugeStyle('circularCapacity'), widgetURL(props.url)]} currentValueLabel={<Text>{soc === null ? '—' : `${Math.round(soc)}`}</Text>} />
    );
  }
  if (family === 'accessoryInline') {
    return <Text modifiers={[widgetURL(props.url)]}>{props.name ? `${percent} · ${props.gridLabel || props.status}` : props.empty}</Text>;
  }
  if (!props.name) {
    return (
      <VStack modifiers={lockScreen ? [widgetURL(props.url)] : shell}>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(lockScreen ? 'primary' : muted)]}>{props.empty}</Text>
      </VStack>
    );
  }
  if (family === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={1} modifiers={[widgetURL(props.url), frame({ maxWidth: 10000, alignment: 'leading' })]}>
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>{props.name}</Text>
        <Text modifiers={[font({ size: 20, weight: 'bold', design: 'rounded' }), monospacedDigit(), lineLimit(1)]}>{`${percent} · ${props.gridLabel || props.status}`}</Text>
        <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>{props.detail || props.updated}</Text>
      </VStack>
    );
  }

  const battery = (
    <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: 10000, alignment: 'leading' })]}>
      <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(muted), lineLimit(1)]}>{props.name}</Text>
      <Text modifiers={[font({ size: 40, weight: 'bold', design: 'rounded' }), foregroundStyle(text), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}>{percent}</Text>
      <ProgressView value={(soc ?? 0) / 100} modifiers={[tint(level)]} />
      <Spacer />
      <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(props.grid === 'none' ? text : gridColor), lineLimit(1), minimumScaleFactor(0.8)]}>{props.gridLabel || props.status}</Text>
      {family === 'systemSmall' ? (
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{props.detail || props.updated}</Text>
      ) : null}
    </VStack>
  );
  if (family === 'systemSmall') return <VStack modifiers={shell}>{battery}</VStack>;

  return (
    <HStack spacing={16} modifiers={shell}>
      {battery}
      <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: 10000, alignment: 'leading' })]}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(text), lineLimit(1)]}>{props.status}</Text>
        {props.detail ? <Text modifiers={[font({ size: 13 }), foregroundStyle(muted), lineLimit(2)]}>{props.detail}</Text> : null}
        <Spacer />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{props.updated}</Text>
      </VStack>
    </HStack>
  );
};

const StationWidget: Widget<StationWidgetProps> | null = createWidget('StationWidget', stationLayout);
export default StationWidget;
