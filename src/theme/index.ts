import { useColorScheme } from 'react-native';

// Diary palette (SPEC section 9).
export const brand = {
  ocean: '#123A5A',
  turquoise: '#12B3C4',
  sun: '#FFC53C',
  coral: '#FF6F61',
  pink: '#FF97C2',
  leaf: '#2FA36B',
  violet: '#7C5CD6',
  cream: '#FFFCF5',
} as const;

export type Palette = {
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  accent: string;
  danger: string;
  success: string;
  star: string;
  inputBg: string;
  tabBar: string;
};

const light: Palette = {
  bg: brand.cream,
  card: '#FFFFFF',
  cardAlt: '#FFF4DC',
  text: brand.ocean,
  textMuted: '#4F6B80',
  border: '#E6E0D2',
  primary: brand.turquoise,
  onPrimary: '#FFFFFF',
  accent: brand.coral,
  danger: '#D64545',
  success: brand.leaf,
  star: brand.sun,
  inputBg: '#FFFFFF',
  tabBar: '#FFFFFF',
};

const dark: Palette = {
  bg: '#0B2236',
  card: '#123A5A',
  cardAlt: '#17476B',
  text: '#F4F8FB',
  textMuted: '#A9C2D3',
  border: '#24557A',
  primary: '#22C3D4',
  onPrimary: '#06202F',
  accent: '#FF8578',
  danger: '#FF7A7A',
  success: '#4CC38A',
  star: brand.sun,
  inputBg: '#0F2E47',
  tabBar: '#0F2E47',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const fonts = {
  title: 'Comfortaa_700Bold',
  titleSemi: 'Comfortaa_600SemiBold',
  body: 'Nunito_400Regular',
  bodySemi: 'Nunito_600SemiBold',
  bodyBold: 'Nunito_700Bold',
  bodyHeavy: 'Nunito_800ExtraBold',
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const radius = { s: 10, m: 16, l: 22, pill: 999 } as const;

// Buttons for 9-year-olds: at least 56 pt high (SPEC section 6).
export const TOUCH_MIN = 56;

// Colours a parent can give a child profile.
export const childColors = [
  brand.turquoise, brand.pink, brand.violet, brand.leaf, brand.coral, brand.sun, '#3B82F6', '#F59E0B',
] as const;
