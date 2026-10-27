"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Categorical slots (dark steps), validated against the app surface: blue, orange, aqua, yellow.
const SERIES = { blue: "#3987e5", orange: "#d95926", aqua: "#199e70", yellow: "#c98500", neutral: "#5d6579" };
const GRID = "#232937";
const AXIS = "#8d95a8";

const axisProps = {
  stroke: AXIS,
  tick: { fill: AXIS, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "#2e3546" },
} as const;

type TooltipProps = {
  active?: boolean;
  payload?: readonly { dataKey?: unknown; name?: unknown; value?: unknown; color?: string }[];
  label?: unknown;
  formatLabel?: (l: string) => string;
};

function ChartTooltip({ active, payload, label, formatLabel }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line-strong bg-surface-3/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1 font-medium text-fg">{formatLabel ? formatLabel(String(label)) : String(label ?? "")}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-6 text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {String(p.name)}
          </span>
          <span className="font-medium tabular-nums text-fg">{String(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

const shortDate = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function ActivityChart({ data }: { data: { day: string; received: number; applied: number; interviews: number }[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" {...axisProps} tickFormatter={shortDate} minTickGap={24} />
          <YAxis {...axisProps} allowDecimals={false} width={44} />
          <Tooltip
            content={(props) => <ChartTooltip {...(props as TooltipProps)} formatLabel={shortDate} />}
            cursor={{ stroke: "#5d6579", strokeDasharray: "3 3" }}
          />
          <Legend iconType="circle" iconSize={8} itemSorter={null} wrapperStyle={{ fontSize: 12, color: AXIS, paddingTop: 8 }} />
          <Line type="linear" dataKey="received" name="Generated" stroke={SERIES.blue} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#11141b" }} />
          <Line type="linear" dataKey="applied" name="Applied" stroke={SERIES.orange} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#11141b" }} />
          <Line type="linear" dataKey="interviews" name="Interviews scheduled" stroke={SERIES.aqua} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#11141b" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type ProfileRow = { id: number; name: string; unscheduled: number; scheduled: number; interviewed_step: number; offered: number; rejected: number };

export function PipelineChart({ profiles }: { profiles: ProfileRow[] }) {
  if (!profiles.length) return <p className="py-16 text-center text-xs text-faint">No applied jobs in this period</p>;
  const height = Math.max(160, profiles.length * 40 + 60);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={profiles} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={10}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" {...axisProps} allowDecimals={false} />
          <YAxis type="category" dataKey="name" {...axisProps} width={130} tick={{ fill: "#c3c8d4", fontSize: 12 }} />
          <Tooltip content={(props) => <ChartTooltip {...(props as TooltipProps)} />} cursor={{ fill: "rgb(255 255 255 / 0.03)" }} />
          <Legend iconType="circle" iconSize={8} itemSorter={null} wrapperStyle={{ fontSize: 12, color: AXIS, paddingTop: 8 }} />
          <Bar dataKey="unscheduled" name="Unscheduled" stackId="s" fill={SERIES.neutral} stroke="#11141b" strokeWidth={2} />
          <Bar dataKey="scheduled" name="Scheduled" stackId="s" fill={SERIES.blue} stroke="#11141b" strokeWidth={2} />
          <Bar dataKey="interviewed_step" name="Interviewed" stackId="s" fill={SERIES.yellow} stroke="#11141b" strokeWidth={2} />
          <Bar dataKey="offered" name="Offered" stackId="s" fill={SERIES.aqua} stroke="#11141b" strokeWidth={2} />
          <Bar dataKey="rejected" name="Rejected" stackId="s" fill={SERIES.orange} stroke="#11141b" strokeWidth={2} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FunnelBars({ stages }: { stages: { label: string; value: number }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  // Ordinal single-hue ramp, darkest step still clears 2:1 on the dark surface.
  const shades = ["#6da7ec", "#3987e5", "#256abf", "#1c5cab"];
  return (
    <ol className="space-y-4">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        return (
          <li key={s.label} className="group">
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-muted">{s.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold text-fg">{s.value.toLocaleString()}</span>
                {prev !== null && (
                  <span className="ml-1.5 text-faint">{prev ? `${Math.round((s.value / prev) * 100)}%` : "—"}</span>
                )}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-surface-3">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(s.value ? 2 : 0, (s.value / max) * 100)}%`, background: shades[i] }}
                title={`${s.label}: ${s.value}`}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type WorkDayRow = { day: string; tailoring: number; assigning: number; applying: number; interviews: number };

// One person's work per day, stacked by kind (the same fixed hue order as the other charts).
export function WorkChart({ data }: { data: WorkDayRow[] }) {
  if (!data.some((d) => d.tailoring || d.assigning || d.applying || d.interviews)) {
    return <p className="py-16 text-center text-xs text-faint">No work recorded in this period</p>;
  }
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barCategoryGap="20%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" {...axisProps} tickFormatter={shortDate} minTickGap={24} />
          <YAxis {...axisProps} allowDecimals={false} width={44} />
          <Tooltip content={(props) => <ChartTooltip {...(props as TooltipProps)} formatLabel={shortDate} />} cursor={{ fill: "rgb(255 255 255 / 0.03)" }} />
          <Legend iconType="circle" iconSize={8} itemSorter={null} wrapperStyle={{ fontSize: 12, color: AXIS, paddingTop: 8 }} />
          <Bar dataKey="tailoring" name="Tailoring" stackId="w" fill={SERIES.blue} stroke="#11141b" strokeWidth={2} />
          <Bar dataKey="assigning" name="Assigning" stackId="w" fill={SERIES.orange} stroke="#11141b" strokeWidth={2} />
          <Bar dataKey="applying" name="Applying" stackId="w" fill={SERIES.aqua} stroke="#11141b" strokeWidth={2} />
          <Bar dataKey="interviews" name="Interviews" stackId="w" fill={SERIES.yellow} stroke="#11141b" strokeWidth={2} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
