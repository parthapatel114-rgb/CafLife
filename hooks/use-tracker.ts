"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  defaults,
  validate,
  type State,
  type RecordRow,
  type Kind,
  type Profile,
} from "@/lib/model";
import {
  getClient,
  readState,
  writeState,
  clearState,
  locked,
  queueChange,
  synchronize,
  Conflict,
  EMPTY,
} from "@/lib/store";
export function useTracker() {
  const [state, setState] = useState<State>(structuredClone(EMPTY)),
    [user, setUser] = useState<User | null>(null),
    [client, setClient] = useState<SupabaseClient | null>(null),
    [ready, setReady] = useState(false),
    [status, setStatus] = useState("Loading"),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState<Conflict | null>(null),
    [demo, setDemo] = useState(false);
  const owner = useRef<string | null>(null),
    running = useRef(false),
    generation = useRef(0),
    stateRef = useRef(state);
  stateRef.current = state;
  const refresh = useCallback(async () => {
    const id = owner.current;
    if (!id) return;
    const s = await readState(id);
    if (owner.current === id) setState(s);
  }, []);
  const sync = useCallback(async () => {
    if (!client || !owner.current || running.current) return;
    if (!navigator.onLine) {
      setStatus("Offline");
      return;
    }
    const id = owner.current;
    running.current = true;
    setStatus("Syncing");
    setError("");
    try {
      await synchronize(client, id, (s) => {
        if (owner.current === id) setState(s);
      });
      if (owner.current === id) {
        setStatus("All changes saved");
        setConflict(null);
      }
    } catch (e) {
      if (owner.current === id) {
        if (e instanceof Conflict) {
          setConflict(e);
          setStatus("Needs your attention");
        } else {
          setStatus(navigator.onLine ? "Sync failed" : "Offline");
          setError(
            "Your changes are on this device. Check your connection or sign in again, then retry.",
          );
        }
      }
    } finally {
      running.current = false;
    }
  }, [client]);
  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    getClient()
      .then(async (c) => {
        if (!active) return;
        setClient(c);
        if (!c) {
          setReady(true);
          setStatus("Preview");
          return;
        }
        const apply = async (u: User | null) => {
          const gen = ++generation.current,
            old = owner.current;
          owner.current = null;
          setState(structuredClone(EMPTY));
          setDemo(false);
          setUser(u);
          if (old && old !== u?.id) await locked(old, () => clearState(old));
          if (!active || gen !== generation.current) return;
          if (u) {
            const prior = localStorage.getItem("caffeine-last-owner");
            if (prior && prior !== u.id) await locked(prior, () => clearState(prior));
            const saved = await readState(u.id);
            if (!active || gen !== generation.current) return;
            owner.current = u.id;
            localStorage.setItem("caffeine-last-owner", u.id);
            localStorage.setItem(
              "caffeine-cached-identity",
              JSON.stringify({ id: u.id, email: u.email }),
            );
            setState(saved);
            setStatus(navigator.onLine ? "Ready to sync" : "Offline");
          } else {
            localStorage.removeItem("caffeine-last-owner");
            localStorage.removeItem("caffeine-cached-identity");
            setStatus("Signed out");
          }
          setReady(true);
        };
        const { data } = await c.auth.getSession();
        const offlineIdentity = !navigator.onLine
          ? JSON.parse(localStorage.getItem("caffeine-cached-identity") ?? "null")
          : null;
        await apply(data.session?.user ?? offlineIdentity ?? null);
        const sub = c.auth.onAuthStateChange((event, session) => {
          if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
          setTimeout(() => {
            if (active && (event === "SIGNED_IN" || (session?.user.id ?? null) !== owner.current))
              void apply(session?.user ?? null).catch(() =>
                setError("Could not open local storage."),
              );
          }, 0);
        });
        unsubscribe = () => sub.data.subscription.unsubscribe();
      })
      .catch(() => {
        setError("Could not open local storage. Check browser storage permissions and reload.");
        setReady(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (user) void sync();
  }, [user, sync]);
  useEffect(() => {
    const online = () => void sync(),
      focus = () => {
        void refresh();
        if (document.visibilityState === "visible") void sync();
      };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [sync, refresh]);
  const change = async (kind: Kind, data: RecordRow["data"], id?: string, deleted = false) => {
    if (!validate(kind, data)) throw new Error("Check the values in this entry.");
    if (
      !deleted &&
      (kind === "caffeine" || kind === "energy") &&
      Date.parse((data as any).at) > Date.now()
    )
      throw new Error("Future entries belong in the Planner.");
    const recordId =
      id ??
      (kind === "profile"
        ? (stateRef.current.records.find((r) => r.kind === "profile")?.id ?? crypto.randomUUID())
        : crypto.randomUUID());
    if (demo) {
      setState((s) => {
        const row = { id: recordId, kind, data, revision: 0, deleted };
        return { ...s, records: [...s.records.filter((r) => r.id !== recordId), row] };
      });
      return recordId;
    }
    const own = owner.current;
    if (!own) throw new Error("Sign in to save your journal, or open the sample preview.");
    await locked(own, async () => {
      const s = await readState(own),
        existing = s.records.find((r) => r.id === recordId);
      const next = queueChange(s, {
        id: recordId,
        kind,
        data,
        revision: existing?.revision ?? 0,
        deleted,
      });
      await writeState(own, next);
      if (owner.current === own) setState(next);
    });
    setStatus(navigator.onLine ? "Pending changes" : "Offline");
    void sync();
    return recordId;
  };
  const startDemo = () => {
    const now = Date.now();
    setDemo(true);
    setStatus("Sample preview");
    setState({
      cursor: 0,
      pending: [],
      records: [
        {
          id: crypto.randomUUID(),
          kind: "profile",
          revision: 0,
          deleted: false,
          data: {
            ...defaults(),
            dailyMax: 250,
            activeMin: 40,
            activeMax: 120,
            bedtimeMax: 25,
            onboarded: true,
          },
        },
        {
          id: crypto.randomUUID(),
          kind: "caffeine",
          revision: 0,
          deleted: false,
          data: {
            name: "Brewed coffee",
            perServing: 96,
            quantity: 1,
            serving: "8 fl oz / 237 mL",
            at: new Date(now - 5 * 3600000).toISOString(),
            preset: "coffee",
          },
        },
        {
          id: crypto.randomUUID(),
          kind: "caffeine",
          revision: 0,
          deleted: false,
          data: {
            name: "Espresso",
            perServing: 63,
            quantity: 1,
            serving: "1 shot / 30 mL",
            at: new Date(now - 2 * 3600000).toISOString(),
            preset: "espresso",
          },
        },
      ],
    });
  };
  const login = async () => {
    if (!client)
      throw new Error("Google sign-in is not configured yet. See the setup note in Settings.");
    if (!navigator.onLine) throw new Error("Connect to the internet to sign in.");
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + "/" },
    });
    if (error) throw error;
  };
  const logout = async () => {
    if (demo) {
      setDemo(false);
      setState(structuredClone(EMPTY));
      setStatus(client ? "Signed out" : "Preview");
      return;
    }
    if (!client) return;
    const id = owner.current;
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    if (id) await locked(id, () => clearState(id));
    owner.current = null;
    setUser(null);
    setState(structuredClone(EMPTY));
  };
  const resolve = async (keepLocal: boolean) => {
    if (!conflict || !owner.current) return;
    const id = owner.current;
    await locked(id, async () => {
      let s = await readState(id);
      const rid = conflict.mutation.record.id,
        latest = s.records.find((r) => r.id === rid) ?? conflict.mutation.record;
      s.pending = s.pending.filter((m) => m.record.id !== rid);
      s.records = s.records.filter((r) => r.id !== rid);
      if (conflict.remote) s.records.push(conflict.remote);
      if (keepLocal)
        s = queueChange(s, {
          ...latest,
          id: conflict.remote?.id ?? latest.id,
          revision: conflict.remote?.revision ?? 0,
        });
      await writeState(id, s);
      setState(s);
    });
    setConflict(null);
    void sync();
  };
  const removeAccount = async () => {
    if (!client || !owner.current) throw new Error("Sign in first.");
    const id = owner.current;
    const { error } = await client.rpc("delete_my_account");
    if (error) throw error;
    await locked(id, () => clearState(id));
    owner.current = null;
    localStorage.removeItem("caffeine-last-owner");
    localStorage.removeItem("caffeine-cached-identity");
    setUser(null);
    setState(structuredClone(EMPTY));
    setStatus("Signed out");
    await client.auth.signOut({ scope: "local" });
  };
  const profile = (state.records.find((r) => r.kind === "profile" && !r.deleted)?.data ??
    defaults()) as Profile;
  return {
    state,
    profile,
    user,
    ready,
    status,
    error,
    conflict,
    demo,
    configured: !!client,
    change,
    sync,
    startDemo,
    login,
    logout,
    resolve,
    removeAccount,
  };
}
