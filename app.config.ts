import type { ExpoConfig } from 'expo/config';

// The site lives at https://<user>.github.io/<repo>/ — the build passes "/<repo>".
const baseUrl = process.env.EXPO_BASE_URL ?? '';

const config: ExpoConfig = {
  name: 'Звёздные баллы',
  slug: 'zvezdnye-bally',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'zvezdnyebally',
  userInterfaceStyle: 'automatic',
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
    name: 'Звёздные баллы',
    shortName: 'Звёзды',
    lang: 'ru',
    themeColor: '#12B3C4',
    backgroundColor: '#FFFCF5',
  },
  plugins: ['expo-router', 'expo-font'],
  experiments: {
    baseUrl,
    reactCompiler: true,
  },
};

export default config;
