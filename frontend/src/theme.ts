import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';

// Brand ramp around "tape blue" — the painter's tape every kitchen labels with.
const tapeBlue: BrandVariants = {
  10: '#050C1A',
  20: '#0A1730',
  30: '#0F2347',
  40: '#142F5E',
  50: '#193B76',
  60: '#1F478E',
  70: '#2551A2',
  80: '#2B5BB7',
  90: '#4B71C3',
  100: '#6787CE',
  110: '#829CD9',
  120: '#9DB2E3',
  130: '#B7C7EC',
  140: '#D0D9F4',
  150: '#E4E9FA',
  160: '#F2F5FD',
};

const fontBase = "'Archivo Variable', 'Segoe UI', system-ui, sans-serif";
const fontMono = "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace";

export const lightTheme: Theme = {
  ...createLightTheme(tapeBlue),
  fontFamilyBase: fontBase,
  fontFamilyMonospace: fontMono,
  colorNeutralBackground2: '#FAF9F7',
  colorNeutralForeground1: '#201B14',
};

// "Service mode": the dark, high-glance theme cook mode runs in.
export const serviceTheme: Theme = {
  ...createDarkTheme(tapeBlue),
  fontFamilyBase: fontBase,
  fontFamilyMonospace: fontMono,
  colorNeutralBackground1: '#211D17',
  colorNeutralBackground2: '#16130F',
  colorNeutralForeground1: '#F5EFE6',
};

export interface TrackHue {
  /** saturated hue for edges and accents */
  deep: string;
  /** light fill for blocks on the light surface */
  tint: string;
  /** validated equivalent for the dark service surface */
  service: string;
}

/**
 * Categorical track palette, assigned to dishes in fixed plan order.
 * Both columns validated (lightness band, chroma floor, CVD separation,
 * contrast) against their surfaces with the dataviz six-checks script.
 */
export const trackHues: TrackHue[] = [
  { deep: '#B4530F', tint: '#F6E3D4', service: '#CE6A2B' }, // ember
  { deep: '#00876B', tint: '#D2EDE6', service: '#2AA78F' }, // teal
  { deep: '#8F6A00', tint: '#F1E8C6', service: '#B08C1C' }, // gold
  { deep: '#83519B', tint: '#ECE0F3', service: '#AC7BC9' }, // plum
  { deep: '#4E7C2A', tint: '#E3EFD4', service: '#6FA53F' }, // herb
  { deep: '#B23A55', tint: '#F8DEE5', service: '#D4627F' }, // rose
];

export function hueFor(index: number): TrackHue {
  return trackHues[((index % trackHues.length) + trackHues.length) % trackHues.length];
}

export const ink = {
  text: '#201B14',
  muted: '#6E6558',
  hairline: '#E2DCD2',
  surface: '#FAF9F7',
  panel: '#FFFFFF',
  late: '#B02E0C',
};

export const service = {
  text: '#F5EFE6',
  muted: '#A79C8C',
  hairline: '#3A342B',
  surface: '#16130F',
  panel: '#211D17',
  late: '#F2803B',
};
