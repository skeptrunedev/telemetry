import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Content width at which a screen switches from one column of cards to two.
// A landscape phone (~800-930dp) and a tablet clear it; portrait phones and
// letterboxed or split-screen windows stay single-column.
const TWO_COLUMN_MIN = 700;

// Below this content width (split screen, a letterboxed window) hero numbers
// step down a size so they fit their cards.
export const COMPACT_WIDTH = 320;

/**
 * Width the shell gives a screen: the window minus the left/right system
 * insets the shell pads off (side nav bar or display cutout in landscape).
 * Drives one- vs two-column layout so nothing assumes a portrait phone.
 */
export function useContentWidth(): { width: number; twoColumn: boolean } {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const w = width - insets.left - insets.right;
  return { width: w, twoColumn: w >= TWO_COLUMN_MIN };
}
