import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

// Graphite & Amber, matching the web app. The dark palette is the original
// one; the light palette keeps the same roles with text colors that clear
// WCAG AA (4.5:1) on both bg and card.
export type Palette = {
  bg: string;
  card: string;
  /** Raised surfaces over bg/card: menus, chips, the avatar. */
  raised: string;
  /** Text-field fill. */
  field: string;
  line: string;
  fg: string;
  muted: string;
  dim: string;
  attention: string;
  info: string;
  /** Amber as a fill (buttons, user bubbles, bars). Text on it is amberInk. */
  amber: string;
  /** Amber as text or an outline on bg/card. */
  amberText: string;
  amberInk: string;
  error: string;
  /** Selected row / pressed tint. */
  selected: string;
  scrim: string;
};

export const DARK: Palette = {
  bg: "#141517",
  card: "#1c1d20",
  raised: "#26282b",
  field: "#1a1c1e",
  line: "#2c2e31",
  fg: "#ececec",
  muted: "#a3a5aa",
  dim: "#6c6f73",
  attention: "#e0894a",
  info: "#5b9bd5",
  amber: "#f59e0b",
  amberText: "#f59e0b",
  amberInk: "#1a1205",
  error: "#ff8a70",
  selected: "rgba(255,255,255,0.1)",
  scrim: "rgba(0,0,0,0.55)",
};

export const LIGHT: Palette = {
  bg: "#f4f3f0",
  card: "#ffffff",
  raised: "#ffffff",
  field: "#ffffff",
  line: "#dddbd6",
  fg: "#17181a",
  muted: "#55585e",
  dim: "#686b70",
  attention: "#b4501a",
  info: "#2b6cb0",
  amber: "#f59e0b",
  amberText: "#a15c07",
  amberInk: "#1a1205",
  error: "#c0392b",
  selected: "rgba(0,0,0,0.07)",
  scrim: "rgba(0,0,0,0.35)",
};

export type ThemePref = "system" | "light" | "dark";
export type Scheme = "light" | "dark";

const PREF_KEY = "skcal_theme";
// The app shipped dark-only; existing users keep that until they choose.
const DEFAULT_PREF: ThemePref = "dark";
const WEB = Platform.OS === "web";

async function readPref(): Promise<ThemePref> {
  try {
    const v = WEB ? globalThis.localStorage?.getItem(PREF_KEY) : await SecureStore.getItemAsync(PREF_KEY);
    return v === "system" || v === "light" || v === "dark" ? v : DEFAULT_PREF;
  } catch {
    return DEFAULT_PREF;
  }
}

async function writePref(p: ThemePref): Promise<void> {
  try {
    if (WEB) globalThis.localStorage?.setItem(PREF_KEY, p);
    else await SecureStore.setItemAsync(PREF_KEY, p);
  } catch {
    // the choice still applies for this session
  }
}

// Native chrome (alerts, pickers, the keyboard) follows the app's choice too.
// "unspecified" hands it back to the OS, which is what System means.
function applyNative(p: ThemePref) {
  try {
    Appearance.setColorScheme(p === "system" ? "unspecified" : p);
  } catch {
    // not supported on this platform (web): only our own views are themed
  }
}

type Theme = { c: Palette; scheme: Scheme; pref: ThemePref; setPref: (p: ThemePref) => void };

const ThemeContext = createContext<Theme>({ c: DARK, scheme: "dark", pref: DEFAULT_PREF, setPref: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref | null>(null);
  // Follows the OS live while pref is "system" (Appearance is "unspecified"),
  // and reports the forced scheme otherwise.
  const os = useColorScheme();

  useEffect(() => {
    readPref().then((p) => {
      applyNative(p);
      setPrefState(p);
    });
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    applyNative(p);
    setPrefState(p);
    writePref(p);
  }, []);

  const value = useMemo<Theme | null>(() => {
    if (!pref) return null;
    const scheme: Scheme = pref === "system" ? (os === "light" ? "light" : "dark") : pref;
    return { c: scheme === "light" ? LIGHT : DARK, scheme, pref, setPref };
  }, [pref, os, setPref]);

  // Hold the first frame until the stored choice is known so a light-mode
  // user never sees a dark flash (the read is a single keystore lookup).
  if (!value) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/**
 * Build a palette-aware stylesheet hook. Each palette's styles are created
 * once and cached, so switching themes swaps style objects without
 * re-running StyleSheet.create on every render.
 */
export function makeStyles<T>(factory: (c: Palette) => T): () => T {
  const cache = new Map<Palette, T>();
  return () => {
    const { c } = useTheme();
    let styles = cache.get(c);
    if (!styles) {
      styles = factory(c);
      cache.set(c, styles);
    }
    return styles;
  };
}
