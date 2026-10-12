// Web: Firebase persiste la sesión en IndexedDB por defecto.
import { getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

import { FIREBASE_CONFIG } from "../config";

let auth: Auth | null = null;

// Se inicializa al primer uso: en modo desarrollo sin login no se toca Firebase.
export function firebaseAuth(): Auth {
  auth ??= getAuth(getApps()[0] ?? initializeApp(FIREBASE_CONFIG));
  return auth;
}
