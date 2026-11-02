import { Dimensions, Platform, StatusBar, useWindowDimensions } from 'react-native';

/** Insets for Android edge-to-edge windows; iOS is handled by SafeAreaView. */
export function useSystemBars() {
  const { height: windowHeight } = useWindowDimensions();
  if (Platform.OS !== 'android') return { top: 0, bottom: 0 };

  const top = StatusBar.currentHeight || 24;
  const screenHeight = Dimensions.get('screen').height;
  const bottom = Math.max(20, screenHeight - windowHeight - top);
  return { top, bottom };
}
