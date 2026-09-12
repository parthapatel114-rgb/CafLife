"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Coffee,
  Plus,
  Moon,
  Activity,
  History as HistoryIcon,
  FlaskConical,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowRight,
  RefreshCw,
  Star,
  Trash2,
  Pencil,
  Download,
  Upload,
  LogOut,
  Sun,
  Check,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Field, Choice } from "./fields";
import dynamic from "next/dynamic";
import { ProfileForm } from "./profile-form";
import { useTracker } from "@/hooks/use-tracker";
import {
  amountAt,
  belowTime,
  consumed,
  dailyTotals,
  dayKey,
  formatTime,
  nextClock,
  localInput,
  presets,
  HOUR,
  validate,
  type Caffeine,
  type Favorite,
  type DrinkCategory,
  type RecordRow,
} from "@/lib/model";
import { exportBackup, exportCSV, parseBackup } from "@/lib/store";
const Curve = dynamic(() => import("./curve").then((module) => module.Curve), {
  ssr: false,
  loading: () => (
    <div className="curve" role="status">
      Loading chart…
    </div>
  ),
});
const favoriteKey = (favorite: Favorite) =>
  [
    favorite.name.trim().toLowerCase(),
    favorite.category ?? "Other",
    favorite.perServing,
    favorite.serving.trim().toLowerCase(),
  ].join("|");
const newDrink = (): Caffeine => ({
  name: "",
  perServing: 0,
  quantity: 1,
  serving: "",
  category: "Coffee",
  at: new Date().toISOString(),
});
// Production CSS optimization folds `translate: none` into `transform`, which
// leaves Tailwind's individual translation active. Inline resets keep both
// independent properties intact for all modal types without changing primitives.
const popupStyle = { translate: "none", transform: "none" } as const;
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Tracker() {
  const t = useTracker(),
    p = t.profile;
  const [tab, setTab] = useState("today"),
    [now, setNow] = useState(Date.now()),
    [modal, setModal] = useState<null | "caffeine" | "profile" | "install" | "account">(null),
    [drink, setDrink] = useState<Caffeine>(newDrink),
    [editing, setEditing] = useState<string | undefined>(),
    [scenario, setScenario] = useState<Caffeine>(() => ({
      ...newDrink(),
      at: new Date(Date.now() + HOUR).toISOString(),
    })),
    [message, setMessage] = useState(""),
    [formError, setFormError] = useState(""),
    [busy, setBusy] = useState(false),
    [undo, setUndo] = useState<RecordRow | null>(null),
    [confirm, setConfirm] = useState<{
      title: string;
      description: string;
      action: () => Promise<void>;
    } | null>(null),
    [days, setDays] = useState("7"),
    [selectedDate, setSelectedDate] = useState(""),
    [inspect, setInspect] = useState(localInput(Date.now())),
    [update, setUpdate] = useState<ServiceWorker | null>(null);
  const { records, coffeeRows, favorites, uniqueFavorites, entries } = useMemo(() => {
    const records = t.state.records.filter((row) => !row.deleted);
    const coffeeRows = records.filter((row) => row.kind === "caffeine");
    const favorites = records.filter((row) => row.kind === "favorite");
    const seen = new Set<string>();
    const uniqueFavorites = favorites.filter((row) => {
      const key = favoriteKey(row.data as Favorite);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      records,
      coffeeRows,
      favorites,
      uniqueFavorites,
      entries: coffeeRows.map((row) => row.data as Caffeine),
    };
  }, [t.state.records]);
  const totalsByDay = useMemo(() => dailyTotals(entries, p.timezone), [entries, p.timezone]);
  const today = dayKey(now, p.timezone),
    current = amountAt(entries, now, p.halfLife),
    total = totalsByDay.get(today) ?? 0;
  const bed = useMemo(() => nextClock(now, p.bedtime, p.timezone), [now, p.bedtime, p.timezone]),
    atBed = amountAt(entries, bed, p.halfLife),
    below = useMemo(
      () => belowTime(entries, now, p.bedtimeMax, p.halfLife),
      [entries, now, p.bedtimeMax, p.halfLife],
    );
  const weightKg = p.weight ? (p.units === "imperial" ? p.weight / 2.20462262 : p.weight) : null;
  const enabled = t.demo || !!t.user;
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const id = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)"),
      apply = () =>
        document.documentElement.classList.toggle(
          "dark",
          p.theme === "dark" || (p.theme === "system" && media.matches),
        );
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [p.theme]);
  useEffect(() => {
    if (t.user && t.ready && !p.onboarded) setModal("profile");
  }, [t.user, t.ready, p.onboarded]);
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator) ||
      location.hostname === "localhost"
    )
      return;
    let active = true;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (reg.waiting) setUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            if (active && sw.state === "installed" && navigator.serviceWorker.controller)
              setUpdate(sw);
          });
        });
      })
      .catch(() =>
        setMessage("Offline installation is unavailable. You can still use the app online."),
      );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("error_description")) {
      setMessage("Google sign-in was not completed. Please try again.");
      history.replaceState({}, "", location.pathname);
    }
  }, []);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setFormError("");
    try {
      await fn();
      if (success) setMessage(success);
    } catch (e) {
      setMessage((e as Error).message);
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const requireAccess = () => {
    if (!enabled) {
      setModal("account");
      return false;
    }
    return true;
  };
  const openDrink = (row?: RecordRow, fav?: Favorite) => {
    if (!requireAccess()) return;
    setEditing(row?.id);
    setDrink(
      row
        ? (row.data as Caffeine)
        : fav
          ? {
              ...fav,
              quantity: 1,
              preset: "favorite",
              at: new Date().toISOString(),
            }
          : newDrink(),
    );
    setFormError("");
    setModal("caffeine");
  };
  const remove = async (row: RecordRow) => {
    await t.change(row.kind, row.data, row.id, true);
    setUndo(row);
    setMessage("Entry removed.");
  };
  const saveFavorite = async (drinkToSave: Caffeine) => {
    const key = favoriteKey(drinkToSave);
    if (favorites.some((row) => favoriteKey(row.data as Favorite) === key)) {
      setMessage("This drink is already saved.");
      return false;
    }
    await t.change("favorite", {
      name: drinkToSave.name,
      perServing: drinkToSave.perServing,
      serving: drinkToSave.serving,
      category: drinkToSave.category,
    });
    return true;
  };
  const saveDrink = async () => {
    if (!validate("caffeine", drink))
      throw new Error("Enter a name, a valid dose, serving quantity, and time.");
    const commit = async () => {
      await t.change("caffeine", drink, editing);
      setModal(null);
      setMessage(t.demo ? "Sample entry saved for this preview." : "Caffeine logged.");
    };
    if (!editing && (drink.preset === "custom" || !drink.preset)) {
      setConfirm({
        title: "Save this drink?",
        description: "It will be available in Saved for future logs.",
        action: async () => {
          await commit();
          const saved = await saveFavorite(drink);
          setMessage(
            saved ? "Drink logged and saved." : "Drink logged. This drink was already saved.",
          );
        },
      });
      return;
    }
    await commit();
  };
  const removeFavorite = async (row: RecordRow) => {
    const key = favoriteKey(row.data as Favorite);
    await Promise.all(
      favorites
        .filter((candidate) => favoriteKey(candidate.data as Favorite) === key)
        .map((candidate) => t.change("favorite", candidate.data, candidate.id, true)),
    );
    setMessage("Saved drink removed.");
  };
  const profileId = records.find((r) => r.kind === "profile")?.id;
  const saveProfile = async (value: any) => {
    await t.change("profile", value, profileId);
    setMessage(t.demo ? "Sample preferences updated." : "Preferences saved.");
  };
  const downloadBackup = () =>
    download("caffeine-backup-" + today + ".json", exportBackup(t.state));
  const requestLogout = () =>
    setConfirm({
      title: t.demo ? "Leave the sample preview?" : "Sign out on this device?",
      description: t.demo
        ? "Sample changes will be discarded."
        : t.state.pending.length
          ? "You have unsynced changes. Export a backup or sync before signing out. Continuing discards them on this device."
          : "Your local journal cache will be cleared. Your synced records remain in your account.",
      action: async () => {
        await t.logout();
        setModal(null);
        setTab("today");
      },
    });
  const timezoneNow = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const journal = (date: string) => {
    const rows = coffeeRows
      .filter((r) => dayKey(Date.parse((r.data as Caffeine).at), p.timezone) === date)
      .sort((a, b) => Date.parse((b.data as Caffeine).at) - Date.parse((a.data as Caffeine).at));
    return rows.length ? (
      <div className="journal">
        {rows.map((row) => {
          const c = row.data as Caffeine;
          return (
            <div className="journal-row" key={row.id}>
              <span className="drink-icon">
                <Coffee size={19} />
              </span>
              <div className="journal-copy">
                <strong>{c.name}</strong>
                <p>
                  {formatTime(Date.parse(c.at), p.timezone)}
                  <span className="dot-separator">·</span>
                  {c.quantity} × {c.serving}
                </p>
              </div>
              <span className="journal-dose">{Math.round(c.perServing * c.quantity)} mg</span>
              <div className="journal-actions">
                <Button
                  variant="ghost"
                  aria-label={"Repeat " + c.name}
                  onClick={() => openDrink(undefined, c)}
                >
                  <Plus size={16} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={"Edit " + c.name}
                  onClick={() => openDrink(row)}
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={"Delete " + c.name}
                  onClick={() => void run(() => remove(row))}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="empty-state">
        <Coffee size={28} />
        <h3>No drinks logged</h3>
        <p>Logged drinks will appear here.</p>
        <Button variant="outline" onClick={() => openDrink()}>
          <Plus />
          Log a drink
        </Button>
      </div>
    );
  };
  const validScenario = validate("caffeine", scenario);
  const planned = useMemo(
    () => (validScenario ? [...entries, scenario] : entries),
    [entries, scenario, validScenario],
  );
  const plannedBed = amountAt(planned, bed, p.halfLife);
  const scenarioTotal = validScenario ? consumed(planned, Date.parse(scenario.at), p.timezone) : 0;
  const forecast = useMemo(() => {
    if (!validScenario) return { peak: now, value: 0, overlap: 0 };
    const pts = Array.from({ length: 289 }, (_, i) => ({
      t: now + i * 300000,
      v: amountAt(planned, now + i * 300000, p.halfLife),
    }));
    const max = pts.reduce((a, b) => (a.v > b.v ? a : b));
    return {
      peak: max.t,
      value: max.v,
      overlap:
        pts
          .slice(0, -1)
          .filter(
            (x) =>
              p.activeMin !== null &&
              p.activeMax !== null &&
              x.v >= p.activeMin &&
              x.v <= p.activeMax,
          ).length * 5,
    };
  }, [planned, validScenario, now, p.halfLife, p.activeMin, p.activeMax]);
  const summaryDays = useMemo(
    () =>
      Array.from({ length: Number(days) }, (_, i) => {
        const d = new Date(today + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() - i);
        return d.toISOString().slice(0, 10);
      }),
    [days, today],
  );
  const loggedDays = summaryDays.map((day) => ({
    day,
    total: totalsByDay.get(day) ?? 0,
  }));
  const historyScale =
    p.dailyMax !== null && p.dailyMax > 0
      ? p.dailyMax
      : Math.max(1, ...loggedDays.map((day) => day.total));
  const weekSummary = useMemo(() => {
    const dayAtOffset = (offset: number) => {
      const d = new Date(today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    const amountForDay = (day: string) => totalsByDay.get(day) ?? 0;
    const current = Array.from({ length: 7 }, (_, i) => amountForDay(dayAtOffset(i))),
      previous = Array.from({ length: 7 }, (_, i) => amountForDay(dayAtOffset(i + 7))),
      total = current.reduce((sum, value) => sum + value, 0),
      previousTotal = previous.reduce((sum, value) => sum + value, 0);
    let streak = 0;
    while (streak < 365 && amountForDay(dayAtOffset(streak)) > 0) streak += 1;
    return {
      total,
      previousTotal,
      average: total / 7,
      previousAverage: previousTotal / 7,
      daysLogged: current.filter((value) => value > 0).length,
      streak,
      highest: Math.max(...current),
    };
  }, [totalsByDay, today]);
  const drinkFields = (value: Caffeine, set: (v: Caffeine) => void, planning = false) => (
    <>
      <Choice
        label="Drink type"
        value={value.category ?? "Other"}
        onChange={(category) =>
          set({
            ...value,
            category: category as DrinkCategory,
            preset: undefined,
          })
        }
        options={[
          { value: "Coffee", label: "Coffee" },
          { value: "Tea", label: "Tea" },
          { value: "Energy drink", label: "Energy drink" },
          { value: "Soda", label: "Soda" },
          { value: "Other", label: "Other" },
        ]}
      />
      <div className="form-grid">
        <Field
          label="Name"
          required
          maxLength={120}
          value={value.name}
          onChange={(e) => set({ ...value, name: e.target.value })}
        />
        <Field
          label="Serving size"
          required
          maxLength={120}
          value={value.serving}
          onChange={(e) => set({ ...value, serving: e.target.value })}
        />
        <Field
          label="Caffeine per serving · mg"
          type="number"
          required
          min="0"
          max="10000"
          step="any"
          value={Number.isNaN(value.perServing) ? "" : value.perServing}
          onChange={(e) =>
            set({
              ...value,
              perServing: e.target.value === "" ? NaN : Number(e.target.value),
            })
          }
        />
        <Field
          label="Number of servings"
          type="number"
          required
          min=".01"
          max="100"
          step="any"
          value={Number.isNaN(value.quantity) ? "" : value.quantity}
          onChange={(e) =>
            set({
              ...value,
              quantity: e.target.value === "" ? NaN : Number(e.target.value),
            })
          }
        />
      </div>
      <Field
        label={planning ? "Planned date & time" : "Consumed date & time"}
        type="datetime-local"
        required
        max={planning ? undefined : localInput(Date.now())}
        value={Number.isFinite(Date.parse(value.at)) ? localInput(Date.parse(value.at)) : ""}
        onChange={(e) =>
          set({
            ...value,
            at: e.target.value ? new Date(e.target.value).toISOString() : "",
          })
        }
        hint={"Entry time uses your phone’s time zone: " + timezoneNow + "."}
      />
      <p className="field-hint">
        Preset caffeine is an estimate. Check the label and adjust for your drink.{" "}
        {presets.find((x) => x.id === value.preset)?.source && (
          <a
            href={presets.find((x) => x.id === value.preset)?.source}
            target="_blank"
            rel="noreferrer"
          >
            View source ↗
          </a>
        )}
      </p>
    </>
  );
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Coffee size={21} />
          </span>
          CafLife
        </div>
        <div className="header-actions">
          <span className="status">
            <span className={"status-dot " + (t.demo ? "sample-dot" : "")} />
            {t.status}
          </span>
          <Button
            variant="ghost"
            className="account-button"
            aria-label="Account"
            onClick={() => setModal("account")}
          >
            {t.user ? (
              <span className="avatar">{t.user.email?.slice(0, 1).toUpperCase()}</span>
            ) : (
              <>
                <span className="google-g">G</span>
                <span>Sign in</span>
              </>
            )}
          </Button>
        </div>
      </header>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(String(v));
          window.scrollTo({ top: 0, behavior: "instant" });
        }}
      >
        <main className="workspace">
          {!t.user && (
            <div className="preview-banner">
              <div>
                <strong>{t.demo ? "Sample preview" : "Save your caffeine history"}</strong>
                <span>
                  {t.demo
                    ? "Illustrative data and targets. Changes are temporary and never sync."
                    : t.configured
                      ? "Sign in with Google to save your caffeine history."
                      : "Google sync is awaiting setup. Explore the working sample preview."}
                </span>
              </div>
              <Button variant="outline" onClick={() => (t.demo ? requestLogout() : t.startDemo())}>
                {t.demo ? "Exit preview" : "Try sample"}
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
          {t.error && (
            <div className="notice error" role="alert">
              {t.error}
              <Button variant="outline" onClick={() => void t.sync()}>
                Retry sync
              </Button>
            </div>
          )}
          {update && (
            <div className="notice">
              An app update is ready.
              <Button
                variant="outline"
                onClick={() => {
                  update.postMessage("ACTIVATE_UPDATE");
                  navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    () => location.reload(),
                    { once: true },
                  );
                }}
              >
                Update app
              </Button>
            </div>
          )}
          {enabled && timezoneNow !== p.timezone && (
            <div className="notice">
              Your phone is in {timezoneNow}. Your journal uses {p.timezone}.
              <Button
                variant="outline"
                onClick={() => void run(() => saveProfile({ ...p, timezone: timezoneNow }))}
              >
                Use phone time zone
              </Button>
            </div>
          )}
          <TabsContent value="today">
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: p.timezone,
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  }).format(now)}
                </p>
                <h1>Today</h1>
                <p>Caffeine levels and targets.</p>
              </div>
              <Button className="primary desktop-log" onClick={() => openDrink()}>
                <Plus />
                Log caffeine
              </Button>
            </div>
            <div className="dashboard-grid">
              <section className="active-card">
                <div className="row">
                  <span>IN YOUR SYSTEM</span>
                  <Activity size={20} />
                </div>
                <div className="big-number">
                  {Math.round(current)}
                  <span>mg</span>
                </div>
                <p>Estimated active caffeine</p>
                <div className="active-footer">
                  <span>
                    {p.activeMin !== null && p.activeMax !== null
                      ? "Preferred range " + p.activeMin + "–" + p.activeMax + " mg"
                      : "Absorption + gradual clearance"}
                  </span>
                  {weightKg && <span>{(current / weightKg).toFixed(2)} mg/kg</span>}
                </div>
              </section>
              <section className="card intake-card">
                <span className="eyebrow">CONSUMED TODAY</span>
                <h2 className="metric">
                  {Math.round(total)} <small>mg</small>
                </h2>
                {p.dailyMax !== null && p.dailyMax > 0 ? (
                  <>
                    <Progress
                      className="intake-progress"
                      value={Math.min(100, (total / p.dailyMax) * 100)}
                      aria-label="Daily caffeine maximum used"
                    />
                    <p className={total > p.dailyMax ? "warning" : ""}>
                      {total > p.dailyMax
                        ? Math.round(total - p.dailyMax) + " mg over your maximum"
                        : Math.round(p.dailyMax - total) + " mg below your maximum"}
                    </p>
                    <span className="small">Your maximum: {p.dailyMax} mg</span>
                  </>
                ) : p.dailyMax === 0 ? (
                  <p className="warning">Daily target is 0 mg; no scale shown.</p>
                ) : (
                  <>
                    <p>No daily maximum set.</p>
                    <button
                      className="text-button"
                      onClick={() => requireAccess() && setModal("profile")}
                    >
                      Set a personal target <ArrowUpRight size={14} />
                    </button>
                  </>
                )}
              </section>
              <section className="card sleep-card">
                <div className="row">
                  <span className="eyebrow">AT BEDTIME</span>
                  <Moon size={21} />
                </div>
                <h2>
                  {Math.round(atBed)} <small>mg</small>
                </h2>
                <p>Estimated at {formatTime(bed, p.timezone)}</p>
                <div className="sleep-target">
                  {p.bedtimeMax === null ? (
                    <button
                      className="text-button"
                      onClick={() => requireAccess() && setModal("profile")}
                    >
                      Set a bedtime ceiling <ArrowUpRight size={14} />
                    </button>
                  ) : p.bedtimeMax === 0 ? (
                    <span>Approaches zero over time</span>
                  ) : (
                    <>
                      <span className={atBed > p.bedtimeMax ? "warning" : "good"}>
                        {atBed > p.bedtimeMax ? "Above" : "Within"} your {p.bedtimeMax} mg ceiling
                      </span>
                      <span className="small">
                        {below === null
                          ? "Below ceiling: beyond 72-hour forecast"
                          : below <= now
                            ? "Below ceiling now"
                            : "Below ceiling " +
                              new Intl.DateTimeFormat("en-US", {
                                timeZone: p.timezone,
                                weekday: "short",
                              }).format(below) +
                              " at " +
                              formatTime(below, p.timezone)}
                      </span>
                    </>
                  )}
                </div>
              </section>
            </div>
            <div className="quick-actions">
              <Button className="primary" onClick={() => openDrink()}>
                <Plus />
                Log caffeine
              </Button>
            </div>
            <section className="card chart-card">
              <div className="row">
                <div>
                  <p className="eyebrow">FROM CUP TO CLEARANCE</p>
                  <h2>Your caffeine curve</h2>
                </div>
              </div>
              <Curve entries={entries} profile={p} now={now} />
              <div className="chart-footnote">
                <Info size={14} />
                <span>Estimated from your logged drinks using a {p.halfLife}-hour half-life.</span>
              </div>
            </section>
            <div className="lower-grid">
              <section className="card journal-card">
                <div className="row">
                  <h2>Today’s journal</h2>
                  <button className="text-button" onClick={() => setTab("history")}>
                    All history <ArrowRight size={15} />
                  </button>
                </div>
                {journal(today)}
              </section>
            </div>
          </TabsContent>
          <TabsContent value="planner">
            <div className="page-heading">
              <div>
                <p className="eyebrow">DRINK PLANNER</p>
                <h1>Plan a drink</h1>
                <p>Explore a drink’s estimated effect before you log it.</p>
              </div>
              <span className="badge">
                <FlaskConical size={14} /> What-if only
              </span>
            </div>
            <div className="planner-grid">
              <section className="card">
                <h2>Plan a drink</h2>
                <p className="section-description">This scenario does not change your journal.</p>
                <div className="form-stack">{drinkFields(scenario, setScenario, true)}</div>
                <div className="scenario-dose">
                  <span>Planned caffeine</span>
                  <strong>
                    {validScenario ? Math.round(scenario.perServing * scenario.quantity) : "—"} mg
                  </strong>
                </div>
                <Button
                  className="primary full-width"
                  disabled={!validScenario}
                  onClick={() => {
                    if (!requireAccess()) return;
                    setConfirm({
                      title: "Log this drink as consumed?",
                      description:
                        Date.parse(scenario.at) > Date.now()
                          ? "This drink is planned for the future. Confirming records it as consumed now."
                          : "This will add the drink to your journal at the selected time.",
                      action: async () => {
                        await t.change("caffeine", {
                          ...scenario,
                          at:
                            Date.parse(scenario.at) > Date.now()
                              ? new Date().toISOString()
                              : scenario.at,
                        });
                        setMessage("Planned drink added to your journal.");
                      },
                    });
                  }}
                >
                  <Plus />I drank this
                </Button>
              </section>
              <div>
                <section className="card chart-card planner-chart">
                  <div className="row">
                    <h2>The next 24 hours</h2>
                    <span className="badge">Estimate</span>
                  </div>
                  <Curve
                    entries={entries}
                    profile={p}
                    now={now}
                    scenario={validScenario ? scenario : undefined}
                  />
                </section>
                <div className="planner-metrics">
                  <section className="card">
                    <span className="eyebrow">MODELED PEAK · NEXT 24H</span>
                    <h2>{formatTime(forecast.peak, p.timezone)}</h2>
                    <p>{Math.round(forecast.value)} mg with this drink</p>
                  </section>
                  <section className="card">
                    <span className="eyebrow">AT YOUR NEXT BEDTIME</span>
                    <h2>{Math.round(plannedBed)} mg</h2>
                    <p>Currently {Math.round(atBed)} mg</p>
                    {p.bedtimeMax !== null && (
                      <span className={plannedBed > p.bedtimeMax ? "warning" : "good"}>
                        {plannedBed > p.bedtimeMax ? "Exceeds" : "Within"} your {p.bedtimeMax} mg
                        ceiling
                      </span>
                    )}
                  </section>
                  <section className="card">
                    <span className="eyebrow">PLANNED DAY’S TOTAL</span>
                    <h2>{Math.round(scenarioTotal)} mg</h2>
                    <p>
                      {p.dailyMax === null
                        ? "Daily maximum not set"
                        : scenarioTotal > p.dailyMax
                          ? "Exceeds your " + p.dailyMax + " mg maximum"
                          : "Within your " + p.dailyMax + " mg maximum"}
                    </p>
                  </section>
                  <section className="card">
                    <span className="eyebrow">TIME IN PREFERRED RANGE</span>
                    <h2>
                      {p.activeMin === null || p.activeMax === null
                        ? "Not set"
                        : (forecast.overlap / 60).toFixed(1) + " h"}
                    </h2>
                    <p>Over the next 24 hours</p>
                  </section>
                </div>
              </div>
            </div>
            <p className="model-note">
              Food, sleep, medications, and individual biology can change how caffeine affects you.
              This planner does not recommend a dose.
            </p>
          </TabsContent>
          <TabsContent value="history">
            <div className="page-heading">
              <div>
                <p className="eyebrow">HISTORY AND TRENDS</p>
                <h1>Caffeine history</h1>
                <p>See your intake patterns, peaks, and target days.</p>
              </div>
              <Choice
                label="Summary period"
                value={days}
                onChange={setDays}
                options={[
                  { value: "7", label: "Last 7 days" },
                  { value: "30", label: "Last 30 days" },
                ]}
              />
            </div>
            <div className="dashboard-grid history-stats">
              <section className="card">
                <span className="eyebrow">AVERAGE DAILY INTAKE</span>
                <h2>
                  {Math.round(loggedDays.reduce((s, d) => s + d.total, 0) / Number(days))}{" "}
                  <small>mg</small>
                </h2>
                <p>Includes days without logs</p>
              </section>
              <section className="card">
                <span className="eyebrow">DAYS ABOVE YOUR MAXIMUM</span>
                <h2>
                  {p.dailyMax === null
                    ? "—"
                    : loggedDays.filter((d) => d.total > p.dailyMax!).length}{" "}
                  <small>/ {days}</small>
                </h2>
                <p>
                  {p.dailyMax === null
                    ? "Set a daily maximum in Settings"
                    : "Compared with your current maximum"}
                </p>
              </section>
            </div>
            <section className="card weekly-summary">
              <div className="row">
                <div>
                  <p className="eyebrow">THIS WEEK</p>
                  <h2>What changed</h2>
                </div>
                <span className="streak-badge">
                  <Sun size={15} /> {weekSummary.streak} day
                  {weekSummary.streak === 1 ? "" : "s"}
                </span>
              </div>
              <div className="weekly-grid">
                <div>
                  <span className="small">Total caffeine</span>
                  <strong>{Math.round(weekSummary.total)} mg</strong>
                </div>
                <div>
                  <span className="small">Daily average</span>
                  <strong>{Math.round(weekSummary.average)} mg</strong>
                </div>
                <div>
                  <span className="small">Days logged</span>
                  <strong>{weekSummary.daysLogged} of 7</strong>
                </div>
              </div>
              <p className="small weekly-change">
                {weekSummary.previousTotal === 0
                  ? "No earlier week to compare yet."
                  : weekSummary.total === weekSummary.previousTotal
                    ? "About the same as last week."
                    : weekSummary.total > weekSummary.previousTotal
                      ? `${Math.round(weekSummary.total - weekSummary.previousTotal)} mg more than last week.`
                      : `${Math.round(weekSummary.previousTotal - weekSummary.total)} mg less than last week.`}
              </p>
            </section>
            <section className="card history-bars">
              <div className="row">
                <div>
                  <h2>Daily intake</h2>
                  <p className="small">
                    0 mg to {Math.round(historyScale)} mg
                    {p.dailyMax !== null && p.dailyMax > 0 ? " maximum" : " logged high"}
                  </p>
                </div>
                {p.dailyMax !== null && p.dailyMax > 0 && (
                  <span className="small">Target: {p.dailyMax} mg</span>
                )}
              </div>
              <div className="bar-list">
                {[...loggedDays].reverse().map((d) => (
                  <button
                    key={d.day}
                    aria-label={
                      d.day +
                      ": " +
                      Math.round(d.total) +
                      " milligrams" +
                      (p.dailyMax !== null && d.total > p.dailyMax
                        ? "; exceeds maximum limit"
                        : "") +
                      "; view journal"
                    }
                    className={
                      p.dailyMax !== null && p.dailyMax > 0 && d.total > p.dailyMax
                        ? "over-limit"
                        : ""
                    }
                    onClick={() => setSelectedDate(d.day)}
                  >
                    <span className="bar-track">
                      <span
                        style={{
                          height: Math.max(2, Math.min(100, (d.total / historyScale) * 100)) + "%",
                        }}
                      />
                    </span>
                    {p.dailyMax !== null && p.dailyMax > 0 && d.total > p.dailyMax && (
                      <span className="bar-over">Over</span>
                    )}
                    <span className="bar-label">{d.day.slice(8)}</span>
                  </button>
                ))}
              </div>
              <p className="small">
                Select a day to open its journal. Days are grouped in {p.timezone}.
              </p>
              <details className="chart-details">
                <summary>View daily totals as text</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Consumed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loggedDays.map((d) => (
                      <tr key={d.day}>
                        <td>{d.day}</td>
                        <td>{Math.round(d.total)} mg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>
            <div className="lower-grid">
              <section className="card">
                <div className="row journal-heading">
                  <h2>Daily journal</h2>
                  <Field
                    label="Journal date"
                    type="date"
                    value={selectedDate || today}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </div>
                {journal(selectedDate || today)}
              </section>
              <section className="card">
                <p className="eyebrow">CHECK A TIME</p>
                <h2>Inspect an estimate</h2>
                <div className="form-stack">
                  <Field
                    label="Date & time on your phone"
                    type="datetime-local"
                    value={inspect}
                    onChange={(e) => setInspect(e.target.value)}
                  />
                  <h2 className="metric">
                    {Number.isFinite(Date.parse(inspect))
                      ? Math.round(amountAt(entries, Date.parse(inspect), p.halfLife))
                      : "—"}{" "}
                    <small>mg estimated</small>
                  </h2>
                  <p className="small">
                    Historical estimates are recalculated with your current {p.halfLife}-hour
                    half-life.
                  </p>
                </div>
              </section>
            </div>
          </TabsContent>
          <TabsContent value="settings">
            <div className="page-heading">
              <div>
                <p className="eyebrow">MAKE IT YOURS</p>
                <h1>Preferences</h1>
                <p>Set your caffeine and sleep targets.</p>
              </div>
            </div>
            <div className="settings-grid">
              <section className="card">
                {enabled ? (
                  <ProfileForm key={profileId ?? "new"} profile={p} onSave={saveProfile} />
                ) : (
                  <div className="empty-state">
                    <SlidersHorizontal />
                    <h2>Set up your profile</h2>
                    <p>Sign in to save your preferences, or explore them in the sample preview.</p>
                    <Button onClick={() => setModal("account")}>Account & sign-in</Button>
                    <Button variant="outline" onClick={t.startDemo}>
                      Try sample
                    </Button>
                  </div>
                )}
              </section>
              <aside className="settings-aside">
                <section className="card">
                  <h2>Your account</h2>
                  <p className="section-description">
                    {t.user?.email ?? (t.demo ? "Temporary sample preview" : "Google sign-in")}
                  </p>
                  {!t.configured && (
                    <p className="setup-note">
                      Account sync is not connected yet. The app needs its Supabase project and
                      Google OAuth provider configured before personal accounts can be used.
                    </p>
                  )}
                  <div className="form-stack">
                    {t.user ? (
                      <>
                        <Button variant="outline" onClick={() => void t.sync()}>
                          <RefreshCw />
                          Retry sync · {t.state.pending.length} pending
                        </Button>
                        <Button variant="outline" onClick={requestLogout}>
                          <LogOut />
                          Sign out
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => void run(t.login)}
                        disabled={!t.configured}
                      >
                        <span className="google-g">G</span>Continue with Google
                      </Button>
                    )}
                  </div>
                </section>
                <section className="card">
                  <h2>Install the app</h2>
                  <p className="section-description">Open this app from your iPhone Home Screen.</p>
                  <Button variant="outline" onClick={() => setModal("install")}>
                    <Plus />
                    Install on iPhone
                  </Button>
                </section>
                <section className="card">
                  <h2>Your data</h2>
                  <p className="section-description">
                    Back up your journal or move a previous backup into this account.
                  </p>
                  <div className="form-stack">
                    <Button variant="outline" disabled={!enabled} onClick={downloadBackup}>
                      <Download />
                      Export full backup
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!enabled}
                      onClick={() =>
                        download("caffeine-logs.csv", exportCSV(t.state, "caffeine"), "text/csv")
                      }
                    >
                      <Download />
                      Export caffeine CSV
                    </Button>

                    <label className={"file-button " + (!enabled ? "disabled" : "")}>
                      <Upload size={16} />
                      Import JSON backup
                      <input
                        type="file"
                        accept=".json,application/json"
                        disabled={!enabled}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          try {
                            if (file.size > 10_000_000)
                              throw new Error("Choose a backup smaller than 10 MB.");
                            const imported = parseBackup(await file.text());
                            setConfirm({
                              title: "Import this backup?",
                              description:
                                "Merge " +
                                imported.length +
                                " records into your journal. Matching IDs are replaced and imported preferences replace your current preferences. Export a backup first if needed.",
                              action: async () => {
                                for (const r of imported)
                                  await t.change(
                                    r.kind,
                                    r.data,
                                    r.kind === "profile" ? profileId : r.id,
                                  );
                                setMessage("Backup imported.");
                              },
                            });
                          } catch (e) {
                            setMessage((e as Error).message);
                          }
                        }}
                      />
                    </label>
                    {t.user && (
                      <Button
                        variant="destructive"
                        onClick={() =>
                          setConfirm({
                            title: "Permanently delete your account?",
                            description:
                              "This removes your profile, journal, saved drinks, and Google-linked app account. It cannot be undone. Your Google account itself is unaffected.",
                            action: async () => {
                              await t.removeAccount();
                              setMessage("Account deleted.");
                            },
                          })
                        }
                      >
                        <Trash2 />
                        Delete my account
                      </Button>
                    )}
                  </div>
                </section>
                <section className="card">
                  <h2>Saved drinks</h2>
                  {uniqueFavorites.length ? (
                    uniqueFavorites.map((r) => {
                      const f = r.data as Favorite;
                      return (
                        <div className="favorite-row" key={r.id}>
                          <div>
                            <strong>{f.name}</strong>
                            <p className="small">
                              {f.category ? f.category + " · " : ""}
                              {f.perServing} mg · {f.serving}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            aria-label={"Remove saved drink " + f.name}
                            onClick={() => void run(() => removeFavorite(r))}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="section-description">
                      Save a drink from the caffeine logger to see it here.
                    </p>
                  )}
                </section>
                <section className="card model-explainer">
                  <h2>How estimates work</h2>
                  <p>
                    We add each drink’s estimated absorption and gradual clearance. The starting
                    half-life is five hours; absorption uses a fixed rate of 4 per hour.
                  </p>
                  <p>
                    Age and height do not change this model. Weight is used only to display mg/kg.
                    Food, medications, pregnancy, smoking, and individual biology can change actual
                    caffeine kinetics.
                  </p>

                  <a
                    href="https://www.ncbi.nlm.nih.gov/books/NBK223808/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read the caffeine pharmacology source ↗
                  </a>
                </section>
              </aside>
            </div>
          </TabsContent>
          <footer className="page-footer">
            <Coffee size={16} />
            <span>Track caffeine. Plan your day.</span>
            <button onClick={() => setTab("settings")}>About the estimate</button>
          </footer>
        </main>
        <TabsList className="bottom-nav" aria-label="Main navigation">
          {[
            { value: "today", label: "Today", Icon: Activity },
            { value: "planner", label: "Planner", Icon: FlaskConical },
            { value: "history", label: "History", Icon: HistoryIcon },
            { value: "settings", label: "Settings", Icon: SlidersHorizontal },
          ].map(({ value, label, Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon size={20} />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent
          style={popupStyle}
          className={"app-dialog " + (modal === "profile" ? "wide-dialog" : "")}
        >
          <DialogTitle>
            {modal === "caffeine"
              ? editing
                ? "Edit caffeine entry"
                : "Log caffeine"
              : modal === "profile"
                ? "Set preferences"
                : modal === "install"
                  ? "Install CafLife"
                  : "Account"}
          </DialogTitle>
          <DialogDescription>
            {modal === "caffeine"
              ? "Choose a drink, check the caffeine, and make it yours."
              : modal === "profile"
                ? "Set up your routine. Personal measurements and targets are optional."
                : modal === "install"
                  ? "Install Caffeine Tracker on your iPhone."
                  : "Sign in with Google to save and sync your own data."}
          </DialogDescription>
          {modal === "caffeine" && (
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(saveDrink);
              }}
            >
              {!editing && (
                <>
                  <p className="field-hint">
                    Create a drink with its name, type, serving size, and caffeine amount.
                  </p>
                  {uniqueFavorites.length > 0 && (
                    <div>
                      <p className="eyebrow">SAVED</p>
                      <div className="quick-preset-row">
                        {uniqueFavorites.map((r) => (
                          <button
                            type="button"
                            key={r.id}
                            aria-label={`Use saved ${
                              (r.data as Favorite).category ?? "drink"
                            }: ${(r.data as Favorite).name}`}
                            onClick={() =>
                              setDrink({
                                ...drink,
                                ...(r.data as Favorite),
                                preset: undefined,
                              })
                            }
                          >
                            <Star size={14} />
                            {(r.data as Favorite).name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {drinkFields(drink, setDrink)}
              <div className="scenario-dose">
                <span>Total caffeine</span>
                <strong>
                  {Number.isFinite(drink.perServing * drink.quantity)
                    ? Math.round(drink.perServing * drink.quantity)
                    : "—"}{" "}
                  mg
                </strong>
              </div>
              {formError && (
                <p className="error" role="alert">
                  {formError}
                </p>
              )}
              <Button type="submit" disabled={busy} className="primary full-width">
                <Check />
                {busy ? "Saving…" : editing ? "Save changes" : "Add to journal"}
              </Button>
            </form>
          )}

          {modal === "profile" && (
            <ProfileForm profile={p} onSave={saveProfile} onDone={() => setModal(null)} />
          )}
          {modal === "install" && (
            <div className="install-steps">
              <p>
                <strong>1</strong> Open this app’s HTTPS link in Safari.
              </p>
              <p>
                <strong>2</strong> Tap Share, then Add to Home Screen. In newer Safari versions,
                Share may be in the More menu.
              </p>
              <p>
                <strong>3</strong> Keep “Open as Web App” enabled if shown, then tap Add.
              </p>
              <div className="notice">
                Sign in and open each screen once while online. Your cached journal and new logs
                will then work offline; sync resumes when you reopen the app online.
              </div>
            </div>
          )}
          {modal === "account" && (
            <div className="form-stack">
              {t.user ? (
                <>
                  <p>{t.user.email}</p>
                  <p className="small">{t.state.pending.length} pending changes on this device.</p>
                  <Button variant="outline" onClick={() => void run(t.sync, "Sync checked.")}>
                    <RefreshCw />
                    Sync now
                  </Button>
                  <Button variant="outline" onClick={requestLogout}>
                    <LogOut />
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    className="primary"
                    disabled={!t.configured || busy}
                    onClick={() => void run(t.login)}
                  >
                    <span className="google-g">G</span>Continue with Google
                  </Button>
                  {!t.configured && (
                    <p className="setup-note">
                      Google sign-in is awaiting Supabase and Google OAuth setup. Personal account
                      saving is unavailable until that connection is configured.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      t.startDemo();
                      setModal(null);
                    }}
                  >
                    Explore sample preview
                  </Button>
                  <p className="small">
                    Sample data is temporary and never becomes part of your caffeine history.
                  </p>
                </>
              )}
              {formError && (
                <p role="alert" className="error">
                  {formError}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <AlertDialogContent style={popupStyle}>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await confirm?.action();
                  setConfirm(null);
                })
              }
            >
              {busy ? "Working…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!t.conflict}>
        <DialogContent style={popupStyle} className="app-dialog" showCloseButton={false}>
          <DialogTitle>One entry, two versions.</DialogTitle>
          <DialogDescription>
            This record changed on another device. Compare the versions before choosing.
          </DialogDescription>
          <div className="conflict-versions">
            <div>
              <h3>This device</h3>
              <pre>{JSON.stringify(t.conflict?.mutation.record.data, null, 2)}</pre>
            </div>
            <div>
              <h3>Synced version</h3>
              <pre>
                {t.conflict?.remote?.deleted
                  ? "Deleted"
                  : (JSON.stringify(t.conflict?.remote?.data, null, 2) ?? "No saved record")}
              </pre>
            </div>
          </div>
          <Button onClick={() => void run(() => t.resolve(true))}>
            Keep this device’s version
          </Button>
          <Button variant="outline" onClick={() => void run(() => t.resolve(false))}>
            Use synced version
          </Button>
        </DialogContent>
      </Dialog>
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          {undo && (
            <button
              onClick={() =>
                void run(async () => {
                  await t.change(undo.kind, undo.data, undo.id);
                  setUndo(null);
                  setMessage("Entry restored.");
                })
              }
            >
              Undo
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => {
              setMessage("");
              setUndo(null);
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
