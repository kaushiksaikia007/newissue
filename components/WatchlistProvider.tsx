"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "./AuthProvider";

export interface WatchItem {
  id: string;
  symbol: string;
  display: string;
  exchange?: string | null;
  type?: string | null;
  currency?: string | null;
  target?: number | null;
  direction?: "above" | "below" | null;
  triggered?: number;
}

export interface AddArgs {
  symbol: string;
  display: string;
  exchange?: string;
  type?: string;
  currency?: string;
}

interface WatchCtxValue {
  items: WatchItem[];
  ready: boolean;
  signedIn: boolean;
  add: (s: AddArgs) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setTarget: (id: string, target: number | null, direction: "above" | "below") => Promise<void>;
  trigger: (id: string) => Promise<void>;
  has: (symbol: string) => boolean;
}

const WatchCtx = createContext<WatchCtxValue>({
  items: [],
  ready: false,
  signedIn: false,
  add: async () => {},
  remove: async () => {},
  setTarget: async () => {},
  trigger: async () => {},
  has: () => false,
});

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { user, getToken } = useAuth();
  const [items, setItems] = useState<WatchItem[]>([]);
  const [ready, setReady] = useState(false);

  const apply = (r: unknown) => {
    const items = (r as { items?: WatchItem[] } | null)?.items;
    if (Array.isArray(items)) setItems(items);
  };

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setItems([]);
      setReady(true);
      return;
    }
    try {
      const r = await fetch(`/api/watchlist?session=${encodeURIComponent(token)}`, {
        cache: "no-store",
      }).then((res) => res.json());
      apply(r);
    } catch {
      /* keep previous */
    }
    setReady(true);
  }, [getToken]);

  // (Re)load whenever the signed-in user changes.
  useEffect(() => {
    load();
  }, [load, user]);

  const send = useCallback(
    async (payload: Record<string, unknown>) => {
      const token = getToken();
      if (!token) return;
      try {
        const r = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: token, ...payload }),
        }).then((res) => res.json());
        apply(r);
      } catch {
        /* ignore */
      }
    },
    [getToken],
  );

  const add = useCallback((s: AddArgs) => send({ action: "add", ...s }), [send]);
  const remove = useCallback((id: string) => send({ action: "remove", id }), [send]);
  const setTarget = useCallback(
    (id: string, target: number | null, direction: "above" | "below") =>
      send({ action: "set_target", id, target, direction }),
    [send],
  );
  const trigger = useCallback((id: string) => send({ action: "trigger", id }), [send]);

  const has = useCallback(
    (symbol: string) => items.some((i) => i.symbol === symbol.toUpperCase()),
    [items],
  );

  const value = useMemo(
    () => ({ items, ready, signedIn: !!user, add, remove, setTarget, trigger, has }),
    [items, ready, user, add, remove, setTarget, trigger, has],
  );

  return <WatchCtx.Provider value={value}>{children}</WatchCtx.Provider>;
}

export const useWatchlist = () => useContext(WatchCtx);
