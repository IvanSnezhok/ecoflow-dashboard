import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { activityBackgroundTint, font, foregroundStyle, lineLimit, monospacedDigit, multilineTextAlignment, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment, type LiveActivityFactory } from 'expo-widgets';

import type { OutageActivityProps } from './types';

// Lower-case on purpose: not a React component, it runs in the widget's own runtime
const outageLayout = (props: OutageActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const over = props.ended !== '';
  const dim = environment.isLuminanceReduced === true;
  const accent = over ? '#12D393' : dim ? '#FFFFFF' : '#F0524B';
  const soc = props.soc;
  const level = soc === null ? '#93A0B5' : soc <= 20 ? '#F0524B' : soc <= 40 ? '#F2B233' : '#12D393';
  const percent = soc === null ? '—' : `${Math.round(soc)}%`;
  const icon = over ? 'bolt.fill' : 'bolt.slash.fill';
  // Counts up by itself from the moment the power went out, with no update from the app
  const timer = over ? null : (
    <Text date={new Date(props.since)} dateStyle="timer" modifiers={[font({ size: 15, weight: 'medium' }), monospacedDigit(), foregroundStyle('#93A0B5'), multilineTextAlignment('trailing')]} />
  );

  return {
    banner: (
      <HStack spacing={12} modifiers={[padding({ all: 16 }), activityBackgroundTint('#0B111E')]}>
        <VStack alignment="leading" spacing={3}>
          <HStack spacing={6}>
            <Image systemName={icon} color={accent} size={15} />
            <Text modifiers={[font({ size: 17, weight: 'bold' }), foregroundStyle(accent), lineLimit(1)]}>{over ? props.ended : props.title}</Text>
          </HStack>
          <Text modifiers={[font({ size: 13 }), foregroundStyle('#93A0B5'), lineLimit(1)]}>{props.name}</Text>
          {props.reserve && !over ? <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle('#F2F5FA'), lineLimit(1)]}>{props.reserve}</Text> : null}
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={2}>
          <Text modifiers={[font({ size: 32, weight: 'bold', design: 'rounded' }), monospacedDigit(), foregroundStyle(level)]}>{percent}</Text>
          {timer}
        </VStack>
      </HStack>
    ),
    compactLeading: <Image systemName={icon} color={accent} size={14} />,
    compactTrailing: <Text modifiers={[font({ size: 14, weight: 'semibold' }), monospacedDigit(), foregroundStyle(level)]}>{percent}</Text>,
    minimal: <Image systemName={icon} color={accent} size={13} />,
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 6, top: 4 })]}>
        <Image systemName={icon} color={accent} size={20} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle('#93A0B5'), lineLimit(1)]}>{props.name}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <Text modifiers={[font({ size: 28, weight: 'bold', design: 'rounded' }), monospacedDigit(), foregroundStyle(level), padding({ trailing: 6, top: 4 })]}>{percent}</Text>
    ),
    expandedBottom: (
      <HStack modifiers={[padding({ horizontal: 6, bottom: 6 })]}>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 16, weight: 'bold' }), foregroundStyle(accent), lineLimit(1)]}>{over ? props.ended : props.title}</Text>
          {props.reserve && !over ? <Text modifiers={[font({ size: 13 }), foregroundStyle('#F2F5FA'), lineLimit(1)]}>{props.reserve}</Text> : null}
        </VStack>
        <Spacer />
        {timer}
      </HStack>
    ),
  };
};

const OutageActivity: LiveActivityFactory<OutageActivityProps> | null = createLiveActivity('OutageActivity', outageLayout);
export default OutageActivity;
