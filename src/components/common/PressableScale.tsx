import React, { ReactNode, useState } from 'react';
import {
  Pressable,
  StyleProp,
  ViewStyle,
  type AccessibilityRole,
} from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

/**
 * The press feedback every tappable thing in ORBII should have.
 *
 * WHY IT IS THIS SMALL. A press happens tens of times a session, which puts it
 * in the tier where motion has to be near-imperceptible or absent. 120ms and a
 * 3 percent scale is the ceiling: anything slower or larger stops reading as
 * the surface responding and starts reading as an animation, and something you
 * see forty times a day should never announce itself.
 *
 * WHY A CSS TRANSITION AND NOT A SHARED VALUE. There is no finger tracking
 * here, just two states. A worklet and a shared value would be the right tool
 * for a drag and the wrong one for a toggle. The transition runs on the UI
 * thread either way, so it keeps moving while JavaScript is busy with location
 * updates, the map, or a Supabase call, which is exactly when the old
 * `Animated` version stuttered.
 *
 * WHY SCALE RATHER THAN OPACITY. Scale carries the label and the icon with it,
 * so the whole control feels like it moved under the finger. Fading a row
 * reads as it becoming disabled.
 *
 * HAPTICS ARE OFF BY DEFAULT, DELIBERATELY. A buzz on every tap in a 52 screen
 * app is how people end up turning haptics off system wide, and then they are
 * gone for the SOS screen too, where they are the only feedback that works with
 * the phone in a pocket. Ask for one only where something is committed.
 */

type HapticKind = 'none' | 'selection' | 'light' | 'medium' | 'success';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** How far it presses in. 0.97 by default; 0.94 suits a large card. */
  scaleTo?: number;
  /** Only for a press that commits something. See the note above. */
  haptic?: HapticKind;
  /** Grows the touch target without growing the visual. */
  hitSlop?: number;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityHint?: string;
  testID?: string;
};

function fireHaptic(kind: HapticKind) {
  if (kind === 'none') return;
  try {
    switch (kind) {
      case 'selection':
        void Haptics.selectionAsync();
        break;
      case 'light':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'success':
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
    }
  } catch {
    // Haptics are absent on plenty of Android hardware and off system wide for
    // many people. Never the only feedback, and never worth surfacing.
  }
}

export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled = false,
  style,
  scaleTo = 0.97,
  haptic = 'none',
  hitSlop = 8,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityHint,
  testID,
}: Props) {
  const [pressed, setPressed] = useState(false);
  // Reduced motion means gentler, not nothing: the press still has to answer,
  // so the scale is dropped and a small opacity change carries the feedback.
  const reduced = useReducedMotion();

  const animatedStyle: ViewStyle = {
    transform: [{ scale: pressed && !reduced ? scaleTo : 1 }],
    opacity: pressed && reduced ? 0.7 : 1,
    // Reanimated CSS transition. Transform and opacity only, so no layout pass.
    transitionProperty: ['transform', 'opacity'],
    transitionDuration: '120ms',
    transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
  } as ViewStyle;

  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              fireHaptic(haptic);
              onPress();
            }
          : undefined
      }
      onLongPress={onLongPress}
      // Feedback on press in, commit on press out. Waiting for the tap to
      // complete before showing anything is the latency people actually feel.
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      hitSlop={hitSlop}
      // A few pixels of finger drift should not cancel a press she meant.
      pressRetentionOffset={16}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
