"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Choice } from "./fields";
import { type Profile, validate } from "@/lib/model";
const timezoneOptions = (current: string) => {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Toronto",
    "America/Vancouver",
    "Europe/London",
    "Europe/Paris",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Australia/Sydney",
    "Pacific/Auckland",
    "UTC",
  ];
  if (!zones.includes(current)) zones.push(current);
  return zones.sort().map((value) => ({ value, label: value.replaceAll("_", " ") }));
};
export function ProfileForm({
  profile,
  onSave,
  onDone,
}: {
  profile: Profile;
  onSave: (p: Profile) => Promise<unknown>;
  onDone?: () => void;
}) {
  const [p, setP] = useState(profile),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const put = (key: keyof Profile, v: any) => setP((x) => ({ ...x, [key]: v }));
  const numeric = (key: keyof Profile, label: string, hint?: string, min = 0, max?: number) => (
    <Field
      key={key}
      label={label}
      hint={hint}
      type="number"
      step="any"
      min={min}
      max={max}
      value={p[key] === null ? "" : String(p[key])}
      onChange={(e) => put(key, e.target.value === "" ? null : Number(e.target.value))}
    />
  );
  return (
    <form
      className="profile-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!validate("profile", p)) {
          setError(
            "Check your values: half-life must be 1–24 hours and the active range minimum must not exceed its maximum.",
          );
          return;
        }
        setBusy(true);
        try {
          await onSave({ ...p, onboarded: true });
          setError("");
          onDone?.();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <section>
        <p className="eyebrow">01 / SLEEP</p>
        <h2>Sleep schedule</h2>
        <p className="section-description">
          Choose your usual bedtime so estimates can include overnight carryover.
        </p>
        <div className="form-grid">
          <Field
            label="Usual bedtime"
            type="time"
            required
            value={p.bedtime}
            onChange={(e) => put("bedtime", e.target.value)}
          />
        </div>
        <Choice
          label="Time zone"
          value={p.timezone}
          onChange={(v) => put("timezone", v)}
          options={timezoneOptions(p.timezone)}
        />
        <p className="field-hint">
          Used to group your journal days and calculate bedtime. Choose the city or region that
          matches your local time.
        </p>
      </section>
      <section>
        <p className="eyebrow">02 / PERSONAL TARGETS</p>
        <h2>Caffeine targets</h2>
        <p className="section-description">
          All targets are optional. These are personal planning settings, not recommended doses.
          Leave a field blank to skip it.
        </p>
        <div className="form-grid">
          {numeric(
            "dailyMax",
            "Daily maximum · mg",
            "Total caffeine consumed in a calendar day. Zero is allowed.",
          )}
          {numeric(
            "bedtimeMax",
            "Bedtime ceiling · mg",
            "Estimated caffeine remaining at bedtime.",
          )}
          {numeric(
            "activeMin",
            "Preferred active minimum · mg",
            "Optional range for comparing scenarios.",
          )}
          {numeric(
            "activeMax",
            "Preferred active maximum · mg",
            "The app will not prompt you to consume more to reach this range.",
          )}
        </div>
      </section>
      <section>
        <p className="eyebrow">03 / ABOUT YOU</p>
        <h2>Personal details</h2>
        <p className="section-description">
          These measurements are optional. Age and height do not change the caffeine estimate.
        </p>
        <Choice
          label="Measurement units"
          value={p.units}
          onChange={(v) => {
            const units = v as Profile["units"];
            setP((x) => ({
              ...x,
              units,
              height:
                x.height === null
                  ? null
                  : Math.round((units === "imperial" ? x.height / 2.54 : x.height * 2.54) * 10) /
                    10,
              weight:
                x.weight === null
                  ? null
                  : Math.round(
                      (units === "imperial" ? x.weight * 2.20462262 : x.weight / 2.20462262) * 10,
                    ) / 10,
            }));
          }}
          options={[
            { value: "metric", label: "Metric · cm, kg" },
            { value: "imperial", label: "Imperial · in, lb" },
          ]}
        />
        <div className="form-grid three">
          {numeric("age", "Age · years", undefined, 0, 120)}
          {numeric("height", "Height · " + (p.units === "metric" ? "cm" : "in"))}
          {numeric(
            "weight",
            "Weight · " + (p.units === "metric" ? "kg" : "lb"),
            "Enables the mg/kg display.",
          )}
        </div>
      </section>
      <section>
        <p className="eyebrow">04 / THE ESTIMATE</p>
        <h2>Understand the assumption.</h2>
        {numeric(
          "halfLife",
          "Caffeine half-life · hours",
          "Time for caffeine to halve after absorption. Five hours is a starting assumption, not a personal measurement.",
          1,
          24,
        )}
        <Choice
          label="Appearance"
          value={p.theme}
          onChange={(v) => put("theme", v)}
          options={[
            { value: "system", label: "Follow my phone" },
            { value: "light", label: "White & coffee" },
            { value: "dark", label: "Dark espresso" },
          ]}
        />
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Button className="primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save my preferences"}
      </Button>
    </form>
  );
}
