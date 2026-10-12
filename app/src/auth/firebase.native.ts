// Android/iOS: la sesión se guarda en AsyncStorage para sobrevivir reinicios.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApps, initializeApp } from "firebase/app";
import type { Auth } from "firebase/auth";
// getReactNativePersistence solo existe en el build "react-native" de
// firebase/auth, que Metro elige; los tipos de TypeScript son los de web.
// @ts-expect-error
import { getReactNativePersistence, initializeAuth } from "firebase/auth";

import { FIREBASE_CONFIG } from "../config";

let auth: Auth | null = null;

// Se inicializa al primer uso: en modo desarrollo sin login no se toca Firebase.
export function firebaseAuth(): Auth {
  auth ??= initializeAuth(getApps()[0] ?? initializeApp(FIREBASE_CONFIG), {
    persistence: getReactNativePersistence(AsyncStorage),
  }) as Auth;
  return auth;
}
