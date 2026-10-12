// Android/iOS: Google Sign-In nativo entrega un idToken que se canjea por una
// sesión de Firebase. Requiere development build (no funciona en Expo Go).
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";

import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from "../config";
import { firebaseAuth } from "./firebase";

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  iosClientId: GOOGLE_IOS_CLIENT_ID,
});

export async function signInWithGoogle(): Promise<void> {
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (res.type !== "success") return; // el usuario cerró el selector
  if (!res.data.idToken) throw new Error("Google no entregó un idToken (revisa webClientId)");
  await signInWithCredential(firebaseAuth(), GoogleAuthProvider.credential(res.data.idToken));
}

export async function signOutFromGoogle(): Promise<void> {
  await GoogleSignin.signOut();
}
