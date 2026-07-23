"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const TOKEN_KEY = "locaul-science:token";

export type AuthUser = { id: string; email: string; createdAt: string };

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  signup: (email: string, password: string) => Promise<{ error?: string }>;
  logout: () => void;
  /** fetch() wrapper that attaches `Authorization: Bearer <token>` automatically. */
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Reads the current token synchronously — for building transport headers. */
  getToken: () => string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  // Read synchronously into a ref too, so authFetch (called from event
  // handlers right after login/signup) never races the state update.
  const tokenRef = useRef<string | null>(null);

  const setSession = useCallback((token: string | null, nextUser: AuthUser | null) => {
    tokenRef.current = token;
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    setUser(nextUser);
    setStatus(nextUser ? "authenticated" : "unauthenticated");
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setStatus("unauthenticated");
      return;
    }
    tokenRef.current = token;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error("invalid session");
        const data = await res.json();
        setUser(data.user);
        setStatus("authenticated");
      })
      .catch(() => {
        setSession(null, null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || "Login failed." };
      setSession(data.token, data.user);
      return {};
    },
    [setSession]
  );

  const signup = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || "Signup failed." };
      setSession(data.token, data.user);
      return {};
    },
    [setSession]
  );

  const logout = useCallback(() => {
    setSession(null, null);
  }, [setSession]);

  const authFetch = useCallback((input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (tokenRef.current) headers.set("Authorization", `Bearer ${tokenRef.current}`);
    return fetch(input, { ...init, headers });
  }, []);

  const getToken = useCallback(() => tokenRef.current, []);

  const value = useMemo(
    () => ({ status, user, login, signup, logout, authFetch, getToken }),
    [status, user, login, signup, logout, authFetch, getToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
