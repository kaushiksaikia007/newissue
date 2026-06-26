// Server-side helper that talks to the PHP auth.php endpoint, keeping the
// shared API token out of the browser. The browser calls /api/auth, which
// forwards to here.

const TOKEN = process.env.PAPER_API_TOKEN || "";
const AUTH_URL =
  process.env.AUTH_API_URL ||
  (process.env.PAPER_API_URL
    ? process.env.PAPER_API_URL.replace(/api\.php$/, "auth.php")
    : "");

export type AuthAction =
  | "signup_start"
  | "signup_verify"
  | "login"
  | "me"
  | "logout";

const ALLOWED: AuthAction[] = [
  "signup_start",
  "signup_verify",
  "login",
  "me",
  "logout",
];

export interface AuthResult {
  status: number;
  data: Record<string, unknown>;
}

export async function authCall(
  action: string,
  payload: Record<string, unknown>,
): Promise<AuthResult> {
  if (!ALLOWED.includes(action as AuthAction)) {
    return { status: 400, data: { error: "unknown_action" } };
  }
  if (!AUTH_URL) {
    return { status: 503, data: { error: "auth_not_configured" } };
  }
  try {
    const res = await fetch(`${AUTH_URL}?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, action, ...payload }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { status: res.status, data };
  } catch {
    return { status: 502, data: { error: "auth_unreachable" } };
  }
}
