import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import "fake-indexeddb/auto";
import {
  dailyTotals,
  clockAt,
  formatTime,
  doseAt,
  amountAt,
  HOUR,
  defaults,
  nextClock,
  dayKey,
  consumed,
  belowTime,
  validate,
  type RecordRow,
  type State,
} from "../lib/model";
import {
  queueChange,
  acceptMutation,
  mergeRemote,
  parseBackup,
  exportBackup,
  exportCSV,
  readState,
  writeState,
  clearState,
  EMPTY,
} from "../lib/store";
const at = Date.parse("2026-09-07T12:00:00Z"),
  drink = {
    name: "Test coffee",
    perServing: 100,
    quantity: 1,
    serving: "1 cup",
    at: new Date(at).toISOString(),
  };
test("absorption starts at zero, rises and then clears with expected half-life", () => {
  assert.equal(doseAt(100, -1), 0);
  assert.equal(doseAt(100, 0), 0);
  assert.ok(doseAt(100, 0.5) > doseAt(100, 0.1));
  assert.ok(doseAt(100, 6) < doseAt(100, 1));
  assert.ok(Math.abs(doseAt(100, 15) / doseAt(100, 10) - 0.5) < 0.00001);
  assert.ok(doseAt(100, 8, 8) > doseAt(100, 8, 3));
});
test("overlapping doses sum and carry across midnight", () => {
  assert.equal(amountAt([drink, drink], at + HOUR), 2 * amountAt([drink], at + HOUR));
  assert.ok(amountAt([drink], at + 20 * HOUR) > 0);
  assert.equal(consumed([drink], at + 24 * HOUR, "UTC"), 0);
});
test("calendar grouping and DST bedtime resolution", () => {
  assert.equal(dayKey(Date.parse("2026-09-08T02:00Z"), "America/New_York"), "2026-09-07");
  assert.equal(
    nextClock(Date.parse("2026-03-08T05:00Z"), "03:30", "America/New_York"),
    Date.parse("2026-03-08T07:30Z"),
  );
  assert.equal(
    nextClock(Date.parse("2026-11-01T04:00Z"), "01:30", "America/New_York"),
    Date.parse("2026-11-01T05:30Z"),
  );
});
test("zero, absent and unreachable bedtime ceilings", () => {
  assert.equal(belowTime([drink], at, 0, 5), null);
  assert.equal(belowTime([drink], at, null, 5), null);
  assert.equal(belowTime([drink], at, 1, 24), null);
  const below = belowTime([drink], at, 25, 5)!;
  assert.ok(below > at + 9 * HOUR);
  assert.ok(amountAt([drink], below, 5) <= 25);
});
test("crossing search waits for absorption peak and future scenario dose", () => {
  const future = { ...drink, at: new Date(at + 10 * HOUR).toISOString() };
  const b = belowTime([future], at, 25, 5)!;
  assert.ok(b > at + 19 * HOUR);
});
test("profile validates skipped targets, zero, ranges and finite inputs", () => {
  assert.ok(validate("profile", defaults()));
  assert.ok(validate("profile", { ...defaults(), dailyMax: 0 }));
  assert.ok(!validate("profile", { ...defaults(), halfLife: 0 }));
  assert.ok(!validate("profile", { ...defaults(), activeMin: 100, activeMax: 20 }));
  assert.ok(!validate("profile", { ...defaults(), dailyMax: NaN }));
  assert.ok(!validate("profile", { ...defaults(), timezone: "bad-zone" }));
  assert.ok(validate("caffeine", { ...drink, quantity: 0.5 }));
  assert.ok(!validate("caffeine", { ...drink, quantity: 0 }));
});
const row: RecordRow = {
  id: crypto.randomUUID(),
  kind: "caffeine",
  data: drink,
  revision: 0,
  deleted: false,
};
test("queue preserves later edits and rebases after acknowledgment", () => {
  let s = queueChange(structuredClone(EMPTY), row);
  const first = s.pending[0];
  s = queueChange(s, { ...row, data: { ...drink, quantity: 2 } });
  s = acceptMutation(s, first, { ...row, revision: 7 });
  assert.equal(s.pending.length, 1);
  assert.equal(s.pending[0].expected, 7);
  assert.equal((s.records[0].data as typeof drink).quantity, 2);
  const merged = mergeRemote(s, [{ ...row, revision: 8 }]);
  assert.equal((merged.records[0].data as typeof drink).quantity, 2);
  assert.equal(merged.cursor, 8);
});
test("backup roundtrip, input rejection and formula-safe CSV", () => {
  const s: State = { records: [row], pending: [], cursor: 0 };
  assert.deepEqual(parseBackup(exportBackup(s)), s.records);
  assert.throws(() => parseBackup('{"app":"other","version":1,"records":[]}'));
  assert.throws(() =>
    parseBackup(JSON.stringify({ app: "caffeine-tracker", version: 1, records: [row, row] })),
  );
  const csv = exportCSV(
    { ...s, records: [{ ...row, data: { ...drink, name: '=HYPERLINK("evil")' } }] },
    "caffeine",
  );
  assert.ok(csv.includes("\"'=HYPERLINK"));
});
test("IndexedDB caches are isolated and clearable by owner", async () => {
  await writeState("a", { records: [row], pending: [], cursor: 1 });
  assert.equal((await readState("a")).records.length, 1);
  assert.equal((await readState("b")).records.length, 0);
  await clearState("a");
  assert.equal((await readState("a")).records.length, 0);
});
test("Postgres: validation, RLS, idempotency, stale conflicts and deletion", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;",
    );
    await db.exec(
      await readFile(new URL("../supabase/migrations/001_caffeine.sql", import.meta.url), "utf8"),
    );
    const alice = crypto.randomUUID(),
      bob = crypto.randomUUID(),
      id = crypto.randomUUID(),
      mutation = crypto.randomUUID();
    await db.query("insert into auth.users values ($1),($2)", [alice, bob]);
    await db.exec("set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [alice]);
    const call = (mid: string, rid: string, data: any, revision = 0, kind = "caffeine") =>
      db.query<{ result: any }>(
        "select public.mutate_record($1,$2,$3,$4::jsonb,$5,false) as result",
        [mid, rid, kind, JSON.stringify(data), revision],
      );
    const first = (await call(mutation, id, drink)).rows[0].result;
    assert.equal(first.conflict, false);
    const repeat = (await call(mutation, id, drink)).rows[0].result;
    assert.deepEqual(repeat, first);
    const stale = (await call(crypto.randomUUID(), id, { ...drink, quantity: 2 })).rows[0].result;
    assert.equal(stale.conflict, true);
    await assert.rejects(
      call(crypto.randomUUID(), crypto.randomUUID(), { ...drink, quantity: -1 }),
    );
    await assert.rejects(
      call(crypto.randomUUID(), crypto.randomUUID(), { ...defaults(), halfLife: 0 }, 0, "profile"),
    );
    await assert.rejects(
      db.query(
        "insert into public.records(owner_id,id,kind,data,revision) values ($1,$2,'caffeine',$3,1)",
        [alice, crypto.randomUUID(), JSON.stringify(drink)],
      ),
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob]);
    assert.equal((await db.query("select * from public.records")).rows.length, 0);
    const own = (await call(crypto.randomUUID(), id, drink)).rows[0].result;
    assert.equal(own.conflict, false);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [alice]);
    assert.equal((await db.query("select * from public.records")).rows.length, 1);
    await db.query("select public.delete_my_account()");
    assert.equal((await db.query("select * from public.records")).rows.length, 0);
    await db.exec("reset role");
    assert.equal((await db.query("select * from auth.users where id=$1", [alice])).rows.length, 0);
    assert.equal((await db.query("select * from auth.users where id=$1", [bob])).rows.length, 1);
  } finally {
    await db.close();
  }
});

test("daily totals group fractional and zero doses by the profile timezone", () => {
  const entries = [
    { ...drink, at: "2026-09-08T02:00:00Z", quantity: 0.5 },
    { ...drink, at: "2026-09-08T03:00:00Z", quantity: 2 },
    { ...drink, at: "2026-09-08T12:00:00Z", perServing: 0 },
  ];
  assert.deepEqual(
    [...dailyTotals(entries, "America/New_York")],
    [
      ["2026-09-07", 250],
      ["2026-09-08", 0],
    ],
  );
  assert.equal(dailyTotals([], "UTC").size, 0);
});
test("cached date formatters remain isolated by timezone and display format", () => {
  assert.equal(clockAt(at, "UTC"), "12:00");
  assert.equal(clockAt(at, "America/New_York"), "08:00");
  assert.equal(formatTime(at, "UTC"), "12:00 PM");
  assert.equal(dayKey(at, "UTC"), "2026-09-07");
  assert.equal(clockAt(at, "UTC"), "12:00");
});
test("remote batches update existing and repeated IDs without overwriting pending edits", () => {
  const second = { ...row, id: crypto.randomUUID(), revision: 2 };
  const local = queueChange({ records: [row], pending: [], cursor: 0 }, row);
  const merged = mergeRemote(local, [
    { ...row, revision: 3, deleted: true },
    second,
    { ...second, revision: 4, deleted: true },
  ]);
  assert.equal(merged.records.length, 2);
  assert.equal(merged.records[0].deleted, false);
  assert.equal(merged.records[1].deleted, true);
  assert.equal(merged.records[1].revision, 4);
  assert.equal(merged.cursor, 4);
  assert.equal(local.records.length, 1);
  assert.equal(local.cursor, 0);
});
