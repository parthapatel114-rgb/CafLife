import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type State, type RecordRow, type Mutation, type Kind, validate } from "./model";
export const EMPTY: State = { records: [], pending: [], cursor: 0 };
let dbPromise: Promise<IDBDatabase> | undefined;
function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("caffeine-tracker-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("accounts");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function readState(owner: string): Promise<State> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("accounts", "readonly"),
      r = tx.objectStore("accounts").get(owner);
    r.onsuccess = () => resolve(r.result ?? structuredClone(EMPTY));
    r.onerror = () => reject(r.error);
  });
}
export async function writeState(owner: string, state: State) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("accounts", "readwrite");
    tx.objectStore("accounts").put(state, owner);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function clearState(owner: string) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("accounts", "readwrite");
    tx.objectStore("accounts").delete(owner);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function locked<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request("caffeine-" + owner, fn);
  throw new Error("This browser needs an update to safely save and synchronize data.");
}
export function queueChange(state: State, record: RecordRow): State {
  const next = structuredClone(state);
  const i = next.records.findIndex((r) => r.id === record.id);
  if (i < 0) next.records.push(record);
  else next.records[i] = record;
  next.pending.push({
    id: crypto.randomUUID(),
    record: structuredClone(record),
    expected: record.revision,
  });
  return next;
}
export function acceptMutation(state: State, mutation: Mutation, remote: RecordRow): State {
  const next = structuredClone(state);
  next.pending = next.pending.filter((m) => m.id !== mutation.id);
  const later = next.pending.filter((m) => m.record.id === remote.id);
  later.forEach((m) => {
    m.expected = remote.revision;
    m.record.revision = remote.revision;
  });
  const i = next.records.findIndex((r) => r.id === remote.id);
  if (i >= 0)
    next.records[i] = later.length
      ? { ...later[later.length - 1].record, revision: remote.revision }
      : remote;
  else next.records.push(remote);
  return next;
}
export function mergeRemote(state: State, rows: RecordRow[]): State {
  const next = structuredClone(state);
  const pendingIds = new Set(next.pending.map((mutation) => mutation.record.id));
  const positions = new Map(next.records.map((record, index) => [record.id, index]));
  for (const row of rows) {
    if (!pendingIds.has(row.id)) {
      const index = positions.get(row.id);
      if (index === undefined) {
        positions.set(row.id, next.records.length);
        next.records.push(row);
      } else {
        next.records[index] = row;
      }
    }
    next.cursor = Math.max(next.cursor, row.revision);
  }
  return next;
}
export class Conflict extends Error {
  constructor(
    public mutation: Mutation,
    public remote: RecordRow | null,
  ) {
    super("This entry changed on another device. Choose which version to keep.");
  }
}
export async function synchronize(
  client: SupabaseClient,
  owner: string,
  onProgress: (s: State) => void,
) {
  return locked(owner, async () => {
    let s = await readState(owner);
    while (s.pending.length) {
      const m = s.pending[0];
      const { data, error } = await client.rpc("mutate_record", {
        mutation_id: m.id,
        record_id: m.record.id,
        record_kind: m.record.kind,
        record_data: m.record.data,
        expected_revision: m.expected,
        is_deleted: m.record.deleted,
      });
      if (error) throw error;
      if (data.conflict) throw new Conflict(m, data.record);
      s = acceptMutation(s, m, data.record);
      await writeState(owner, s);
      onProgress(s);
    }
    let more = true;
    while (more) {
      const { data, error } = await client
        .from("records")
        .select("id,kind,data,revision,deleted")
        .gt("revision", s.cursor)
        .order("revision")
        .limit(500);
      if (error) throw error;
      const rows = data as RecordRow[];
      s = mergeRemote(s, rows);
      await writeState(owner, s);
      onProgress(s);
      more = rows.length === 500;
    }
    return s;
  });
}
let auth: SupabaseClient | null = null;
export async function getClient() {
  if (auth) return auth;
  let config: any;
  try {
    const r = await fetch("/api/config");
    if (!r.ok) throw new Error();
    config = await r.json();
    localStorage.setItem("caffeine-public-config", JSON.stringify(config));
  } catch {
    config = JSON.parse(localStorage.getItem("caffeine-public-config") ?? "{}");
  }
  if (!config.url || !config.key) return null;
  auth = createClient(config.url, config.key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return auth;
}
export function exportBackup(state: State) {
  return JSON.stringify(
    {
      app: "caffeine-tracker",
      version: 1,
      exportedAt: new Date().toISOString(),
      records: state.records
        .filter((r) => !r.deleted)
        .map(({ id, kind, data }) => ({ id, kind, data })),
    },
    null,
    2,
  );
}
export function parseBackup(text: string): RecordRow[] {
  const b = JSON.parse(text);
  if (
    b.app !== "caffeine-tracker" ||
    b.version !== 1 ||
    !Array.isArray(b.records) ||
    b.records.length > 50000
  )
    throw new Error("This is not a supported Caffeine Tracker backup.");
  const ids = new Set();
  let profiles = 0;
  return b.records.map((r: any) => {
    if (!/^[0-9a-f-]{36}$/i.test(r.id) || ids.has(r.id) || !validate(r.kind as Kind, r.data))
      throw new Error("The backup contains an invalid or duplicate record.");
    ids.add(r.id);
    if (r.kind === "profile" && ++profiles > 1)
      throw new Error("A backup may contain only one profile.");
    if ((r.kind === "energy" || r.kind === "caffeine") && Date.parse(r.data.at) > Date.now())
      throw new Error("A backup cannot contain future consumption or energy logs.");
    return { ...r, revision: 0, deleted: false };
  });
}
export function csvEscape(value: unknown) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function exportCSV(state: State, kind: "caffeine" | "energy") {
  const keys =
    kind === "caffeine"
      ? ["at", "name", "perServing", "quantity", "serving"]
      : ["at", "rating", "note"];
  return [
    keys.join(","),
    ...state.records
      .filter((r) => r.kind === kind && !r.deleted)
      .map((r) => keys.map((k) => csvEscape((r.data as any)[k])).join(",")),
  ].join("\r\n");
}
