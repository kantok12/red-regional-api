import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { firebaseAuth } from "./firebase";
import { signInWithGoogle, signOutFromGoogle } from "./google";

/** Lo que la app usa del usuario; un `User` de Firebase lo cumple. */
export type AppUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type AuthState = {
  user: AppUser | null;
  initializing: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

// Solo en desarrollo: entra sin Google (el backend debe correr con AUTH_DISABLED=1).
const DEV_NO_AUTH = __DEV__ && process.env.EXPO_PUBLIC_DEV_NO_AUTH === "1";
const DEV_USER: AppUser = {
  uid: "dev",
  email: "dev@localhost",
  displayName: "Desarrollo",
  photoURL: null,
  getIdToken: async () => "",
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (DEV_NO_AUTH) {
      setUser(DEV_USER);
      setInitializing(false);
      return;
    }
    return onAuthStateChanged(firebaseAuth(), (u) => {
      setUser(u);
      setInitializing(false);
    });
  }, []);

  const value: AuthState = DEV_NO_AUTH
    ? { user, initializing, signIn: async () => setUser(DEV_USER), signOut: async () => setUser(null) }
    : {
        user,
        initializing,
        signIn: signInWithGoogle,
        signOut: async () => {
          await signOutFromGoogle().catch(() => {});
          await firebaseSignOut(firebaseAuth());
        },
      };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
