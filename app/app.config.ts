import type { ExpoConfig } from "expo/config";

// Las claves se leen de variables de entorno (.env, ver .env.example) para no
// dejarlas en el repositorio.
const env = process.env;

const config: ExpoConfig = {
  name: "Red Regional en vivo",
  slug: "red-regional",
  scheme: "redregional",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.IOS_BUNDLE_ID ?? "cl.redregional.app",
  },
  android: {
    package: env.ANDROID_PACKAGE ?? "cl.redregional.app",
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
    output: "single",
  },
  plugins: [
    "expo-router",
    [
      "@react-native-google-signin/google-signin",
      // URL scheme = client ID de iOS invertido: com.googleusercontent.apps.XXXX
      { iosUrlScheme: env.GOOGLE_IOS_URL_SCHEME ?? "com.googleusercontent.apps.placeholder" },
    ],
    [
      "react-native-maps",
      {
        androidGoogleMapsApiKey: env.GOOGLE_MAPS_ANDROID_API_KEY,
        iosGoogleMapsApiKey: env.GOOGLE_MAPS_IOS_API_KEY,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
