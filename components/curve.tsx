"use client";
import { useId, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { amountAt, formatTime, nextClock, HOUR, type Caffeine, type Profile } from "@/lib/model";
export function Curve({
  entries,
  profile,
  now,
  scenario,
}: {
  entries: Caffeine[];
  profile: Profile;
  now: number;
  scenario?: Caffeine;
}) {
  const [inspected, setSelected] = useState<number | null>(null);
  const gradientId = useId().replaceAll(":", "");
  const bed = useMemo(
    () => nextClock(now, profile.bedtime, profile.timezone),
    [now, profile.bedtime, profile.timezone],
  );
  const todaySeven = nextClock(now, "07:00", profile.timezone),
    start = todaySeven > now ? todaySeven - 24 * HOUR : todaySeven,
    end = start + 24 * HOUR;
  const selected = Math.min(end, Math.max(start, inspected ?? now));
  const points = useMemo(
    () =>
      Array.from({ length: 289 }, (_, i) => {
        const t = start + i * 5 * 60000;
        const actual = amountAt(entries, t, profile.halfLife);
        return {
          t,
          actual,
          scenario: scenario ? actual + amountAt([scenario], t, profile.halfLife) : undefined,
        };
      }),
    [entries, start, profile.halfLife, scenario],
  );
  const yMax = useMemo(
    () => Math.max(120, ...points.map((x) => Math.max(x.actual, x.scenario ?? 0))) * 1.15,
    [points],
  );
  const yStep = Math.max(20, Math.ceil(yMax / 4 / 10) * 10),
    yTicks = Array.from({ length: 5 }, (_, i) => i * yStep);
  const selectedPoint = useMemo(
    () => ({
      actual: amountAt(entries, selected, profile.halfLife),
      scenario: scenario ? amountAt([...entries, scenario], selected, profile.halfLife) : undefined,
    }),
    [entries, selected, profile.halfLife, scenario],
  );
  const ticks = Array.from({ length: 49 }, (_, i) => start + i * 30 * 60000);
  const sliderMax = Math.round((end - start) / 300000),
    sliderValue = Math.round((Math.min(end, Math.max(start, selected)) - start) / 300000);
  return (
    <>
      <div className="curve-markers" aria-label="Timeline markers">
        <button type="button" className="marker-now" onClick={() => setSelected(null)}>
          <span>
            <i />
            Now
          </span>
          <strong>{formatTime(now, profile.timezone)}</strong>
        </button>
        <button
          type="button"
          className="marker-bedtime"
          onClick={() => setSelected(bed)}
          disabled={bed > end}
        >
          <span>
            <i />
            Bedtime
          </span>
          <strong>{formatTime(bed, profile.timezone)}</strong>
          {bed > end && <small>After this timeline</small>}
        </button>
      </div>
      <div className="chart-legend">
        <span>
          <i />
          Estimated caffeine
        </span>
        {scenario && (
          <span>
            <i className="scenario-dot" />
            With planned drink
          </span>
        )}
      </div>
      <div
        className="curve"
        role="img"
        aria-label="Interactive caffeine estimate chart. Tap the curve to inspect a time."
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 260 }}
        >
          <ComposedChart
            data={points}
            margin={{ top: 12, right: 12, bottom: 8, left: 0 }}
            accessibilityLayer
            onClick={(state: any) => {
              const x = state?.activePayload?.[0]?.payload?.t;
              if (typeof x === "number") setSelected(x);
            }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--chart)" stopOpacity={0.015} />
              </linearGradient>
            </defs>
            <XAxis type="number" dataKey="t" domain={[start, end]} ticks={ticks} hide />
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
            <YAxis
              width={40}
              domain={[0, yStep * 4]}
              ticks={yTicks}
              tickFormatter={(v) => `${Math.round(v)}`}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            {profile.activeMin !== null && profile.activeMax !== null && (
              <ReferenceArea
                y1={profile.activeMin}
                y2={profile.activeMax}
                fill="var(--gold)"
                fillOpacity={0.055}
              />
            )}
            <ReferenceLine x={now} stroke="var(--chart)" strokeDasharray="4 4" />
            {bed <= end && <ReferenceLine x={bed} stroke="var(--gold)" strokeDasharray="3 5" />}
            <ReferenceLine x={selected} stroke="var(--foreground)" strokeDasharray="2 2" />
            <Area
              dataKey="actual"
              name="Estimated caffeine"
              type="monotone"
              stroke="var(--chart)"
              strokeWidth={3}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
            {scenario && (
              <Line
                dataKey="scenario"
                name="With planned drink"
                type="monotone"
                stroke="var(--gold)"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-inspector">
        <div>
          <span className="eyebrow">INSPECTING</span>
          <strong>{formatTime(selected, profile.timezone)}</strong>
        </div>
        <div>
          <span>Estimated</span>
          <strong>{Math.round(selectedPoint.actual)} mg</strong>
        </div>
        {scenario && (
          <div>
            <span>With planned drink</span>
            <strong>{Math.round(selectedPoint.scenario ?? 0)} mg</strong>
          </div>
        )}
      </div>
      <div className="chart-slider-wrap">
        <div className="chart-slider-labels">
          <span>{formatTime(start, profile.timezone)}</span>
          <strong>{formatTime(selected, profile.timezone)}</strong>
          <span>Next {formatTime(end, profile.timezone)}</span>
        </div>
        <label className="chart-slider">
          <span className="sr-only">Inspect a time in the chart</span>
          <input
            type="range"
            min="0"
            max={sliderMax}
            step="1"
            value={sliderValue}
            aria-valuetext={`${formatTime(selected, profile.timezone)}, ${Math.round(selectedPoint.actual)} milligrams`}
            onChange={(e) => setSelected(start + Number(e.target.value) * 300000)}
          />
        </label>
      </div>
      <details className="chart-details">
        <summary>View estimates every 30 minutes</summary>
        <div className="table-scroll">
          <table>
            <caption>
              Estimates use your current {profile.halfLife}-hour half-life. Times in{" "}
              {profile.timezone}.
            </caption>
            <thead>
              <tr>
                <th>Time</th>
                <th>Estimated caffeine</th>
                {scenario && <th>With planned drink</th>}
              </tr>
            </thead>
            <tbody>
              {points
                .filter((_, i) => i % 6 === 0)
                .map((p) => (
                  <tr key={p.t}>
                    <td>{formatTime(p.t, profile.timezone)}</td>
                    <td>{Math.round(p.actual)} mg</td>
                    {scenario && <td>{Math.round(p.scenario ?? 0)} mg</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
