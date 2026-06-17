import { lightTheme } from '@rainbow-me/rainbowkit';

// Light theme for ChatKit — unified with the frosted modal surface
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pulseTheme: any = {
  colorScheme: 'light',
  typography: {
    baseSize: 14,
    fontFamily: "'ABC Monument Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontFamilyMono: "'SF Mono', 'Fira Code', 'Fira Mono', monospace",
    // fontSources omitted — fonts loaded via our CSS @font-face; iframe can't cross-origin load
    fontSources: [],
  },
  radius: 'pill',
  density: 'compact',
  color: {
    grayscale: {
      hue: 220,
      tint: 1,
      shade: 2,
    },
    accent: {
      primary: '#3b7dd8',
      level: 3,
    },
    surface: {
      background: '#ffffff',
      foreground: '#f5f7fa',
    },
  },
};

export const rainbowKitTheme = lightTheme({
  accentColor: '#3b7dd8',
  accentColorForeground: '#ffffff',
  borderRadius: 'medium',
});
