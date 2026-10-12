// Web: popup de Google gestionado por Firebase.
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

import { firebaseAuth } from "./firebase";

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(firebaseAuth(), provider);
}

export async function signOutFromGoogle(): Promise<void> {}
