"use client";

import { useAuth } from "./AuthProvider";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function UserMenu() {
  const { user, ready, openAuth, logout } = useAuth();

  if (!ready) return null;

  if (!user) {
    return (
      <button className="user-signin" onClick={openAuth}>
        <span className="user-signin-icon">↪</span> Sign in
      </button>
    );
  }

  return (
    <div className="user-menu">
      <div className="user-avatar" tabIndex={0} aria-label={`${user.name}, ${user.email}`}>
        {initials(user.name)}
        <div className="user-card">
          <div className="user-card-name">{user.name}</div>
          <div className="user-card-email">{user.email}</div>
        </div>
      </div>
      <button className="user-logout" onClick={logout} title="Log out">
        Log out
      </button>
    </div>
  );
}
