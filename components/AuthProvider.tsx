"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import AuthModal from "./AuthModal";

export interface User {
  id: number;
  name: string;
  email: string;
}

interface AuthResponse {
  ok?: boolean;
  error?: string;
  token?: string;
  user?: User;
}

interface AuthContextValue {
  user: User | null;
  ready: boolean;
  /** Current session token, if signed in (for authenticated API calls). */
  getToken: () => string | null;
  /** Returns true if signed in; otherwise opens the auth popup and returns false. */
  requireAuth: () => boolean;
  openAuth: () => void;
  closeAuth: () => void;
  login: (email: string, password: string) => Promise<string | null>;
  signupStart: (
    name: string,
    email: string,
    password: string,
  ) => Promise<string | null>;
  signupVerify: (email: string, otp: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

const TOKEN_KEY = "nib-auth-token";
const AuthContext = createContext<AuthContextValue | null>(null);

async function post(payload: Record<string, unknown>): Promise<{
  status: number;
  data: AuthResponse;
}> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as AuthResponse;
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { error: "network" } };
  }
}

// Friendly messages for the error codes the PHP returns.
const ERRORS: Record<string, string> = {
  invalid_name: "Please enter your full name.",
  invalid_email: "That email address looks invalid.",
  weak_password: "Password must be at least 6 characters.",
  email_taken: "An account with this email already exists. Try logging in.",
  no_pending: "No pending signup found — please start again.",
  too_many_attempts: "Too many wrong codes. Please sign up again.",
  otp_expired: "That code has expired. Please request a new one.",
  wrong_otp: "Incorrect code. Please check your email and try again.",
  bad_credentials: "Wrong email or password.",
  auth_not_configured: "Sign-in is not available right now.",
  auth_unreachable: "Couldn't reach the server. Please try again.",
  network: "Network error. Please check your connection.",
};
const msg = (code?: string) =>
  (code && ERRORS[code]) || "Something went wrong. Please try again.";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  // Validate any stored session on first load.
  useEffect(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (!token) {
      setReady(true);
      return;
    }
    post({ action: "me", session: token }).then(({ data }) => {
      if (data.ok && data.user) setUser(data.user);
      else localStorage.removeItem(TOKEN_KEY);
      setReady(true);
    });
  }, []);

  const openAuth = useCallback(() => setOpen(true), []);
  const closeAuth = useCallback(() => setOpen(false), []);
  const getToken = useCallback(
    () => (typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null),
    [],
  );

  const requireAuth = useCallback(() => {
    if (user) return true;
    setOpen(true);
    return false;
  }, [user]);

  const finishAuth = (data: AuthResponse) => {
    if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
    if (data.user) setUser(data.user);
    setOpen(false);
  };

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await post({ action: "login", email, password });
    if (data.ok) {
      finishAuth(data);
      return null;
    }
    return msg(data.error);
  }, []);

  const signupStart = useCallback(
    async (name: string, email: string, password: string) => {
      const { data } = await post({
        action: "signup_start",
        name,
        email,
        password,
      });
      if (data.ok) return null;
      return msg(data.error);
    },
    [],
  );

  const signupVerify = useCallback(async (email: string, otp: string) => {
    const { data } = await post({ action: "signup_verify", email, otp });
    if (data.ok) {
      finishAuth(data);
      return null;
    }
    return msg(data.error);
  }, []);

  const logout = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    if (token) await post({ action: "logout", session: token });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        getToken,
        requireAuth,
        openAuth,
        closeAuth,
        login,
        signupStart,
        signupVerify,
        logout,
      }}
    >
      {children}
      {open && <AuthModal />}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
