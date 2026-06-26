"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

type Mode = "login" | "signup";
type Step = "form" | "otp";

export default function AuthModal() {
  const { closeAuth, login, signupStart, signupVerify } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<Step>("form");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAuth();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAuth]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep("form");
    setError(null);
    setInfo(null);
    setOtp("");
  };

  const submitLogin = async () => {
    setBusy(true);
    setError(null);
    const err = await login(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
  };

  const submitSignup = async () => {
    setBusy(true);
    setError(null);
    const err = await signupStart(name.trim(), email.trim(), password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setStep("otp");
    setInfo(`We sent a 6-digit code to ${email.trim()}. Enter it below.`);
  };

  const submitOtp = async () => {
    setBusy(true);
    setError(null);
    const err = await signupVerify(email.trim(), otp.trim());
    setBusy(false);
    if (err) setError(err);
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    const err = await signupStart(name.trim(), email.trim(), password);
    setBusy(false);
    if (err) setError(err);
    else setInfo(`A new code was sent to ${email.trim()}.`);
  };

  return (
    <div className="modal-overlay" onClick={closeAuth} role="presentation">
      <div
        className="modal auth-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <div>
            <div className="modal-title">
              {step === "otp"
                ? "Verify your email"
                : mode === "login"
                  ? "Welcome back"
                  : "Create your account"}
            </div>
            <div className="modal-sub">
              {step === "otp"
                ? "One last step to secure your account"
                : "Sign in to analyze markets, generate strategies and paper trade"}
            </div>
          </div>
          <button className="modal-close" onClick={closeAuth} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {step === "form" && (
            <div className="auth-tabs">
              <button
                className={`auth-tab${mode === "login" ? " active" : ""}`}
                onClick={() => switchMode("login")}
              >
                Login
              </button>
              <button
                className={`auth-tab${mode === "signup" ? " active" : ""}`}
                onClick={() => switchMode("signup")}
              >
                Sign up
              </button>
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}
          {info && step === "otp" && <div className="auth-info">{info}</div>}

          {step === "form" ? (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
                mode === "login" ? submitLogin() : submitSignup();
              }}
            >
              {mode === "signup" && (
                <label className="auth-field">
                  <span>Full name</span>
                  <input
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Trader"
                    required
                  />
                </label>
              )}
              <label className="auth-field">
                <span>Email address</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
                  required
                />
              </label>
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "login"
                    ? "Log in"
                    : "Send verification code"}
              </button>
              <div className="auth-switch">
                {mode === "login" ? (
                  <>
                    New here?{" "}
                    <button type="button" onClick={() => switchMode("signup")}>
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already registered?{" "}
                    <button type="button" onClick={() => switchMode("login")}>
                      Log in
                    </button>
                  </>
                )}
              </div>
            </form>
          ) : (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) submitOtp();
              }}
            >
              <label className="auth-field">
                <span>Verification code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  className="auth-otp"
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="••••••"
                  autoFocus
                  required
                />
              </label>
              <button
                className="auth-submit"
                type="submit"
                disabled={busy || otp.length !== 6}
              >
                {busy ? "Verifying…" : "Verify & create account"}
              </button>
              <div className="auth-switch">
                Didn&apos;t get it?{" "}
                <button type="button" onClick={resend} disabled={busy}>
                  Resend code
                </button>
                <span className="auth-dot">·</span>
                <button type="button" onClick={() => switchMode("signup")}>
                  Change details
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
