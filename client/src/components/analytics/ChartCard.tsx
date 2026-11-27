import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { ChartEmpty, Donut, PALETTE, tip } from "@/components/dashboard/widgetUi";
import type { ChartDef } from "./analyticsTypes";

const axis = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } } as const;
const colorOf = (d: { color?: string }, i: number) => d.color || PALETTE[i % PALETTE.length];

function Body({ c }: { c: ChartDef }) {
  const uid = useId().replace(/:/g, "");
  const unit = c.unit || "";
  const fmt = (v: unknown) => `${v}${unit}`;

  if (c.type === "donut") {
    const data = (c.data || []).filter((d) => d.value > 0).map((d, i) => ({ name: d.name, value: d.value, fill: colorOf(d, i) }));
    return <Donut data={data} center={fmt(Math.round(data.reduce((a, d) => a + d.value, 0) * 10) / 10)} sub="total" />;
  }

  if (c.type === "bar" || c.type === "hbar") {
    const data = c.data || [];
    if (!data.length || data.every((d) => d.value === 0)) return <ChartEmpty text="No data for this period" />;
    const horizontal = c.type === "hbar";
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={horizontal ? { top: 4, right: 36, left: 0, bottom: 4 } : { top: 18, right: 8, left: -16, bottom: 0 }}>
          {!horizontal && <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />}
          {horizontal ? <XAxis type="number" hide /> : <XAxis dataKey="name" {...axis} interval={0} />}
          {horizontal ? <YAxis type="category" dataKey="name" width={118} {...axis} tick={{ fontSize: 12 }} /> : <YAxis allowDecimals={false} {...axis} />}
          <Tooltip contentStyle={tip} cursor={{ fill: "hsl(var(--secondary))" }} formatter={(v) => [fmt(v), c.title]} />
          <Bar dataKey="value" name={c.title} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} barSize={horizontal ? 16 : undefined}>
            {data.map((d, i) => <Cell key={i} fill={colorOf(d, i)} />)}
            <LabelList dataKey="value" position={horizontal ? "right" : "top"} formatter={fmt} style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  const xs = c.x || [], ser = c.series || [];
  if (!xs.length || !ser.length || ser.every((s) => s.values.every((v) => v === 0))) return <ChartEmpty text="No data for this period" />;
  const rows = xs.map((name, i) => ({ name, ...Object.fromEntries(ser.map((s, k) => [`s${k}`, s.values[i] ?? 0])) }));

  if (c.type === "hstacked") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={118} {...axis} tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={tip} cursor={{ fill: "hsl(var(--secondary))" }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {ser.map((s, k) => <Bar key={k} dataKey={`s${k}`} name={s.name} stackId="a" fill={s.color} barSize={16} radius={k === ser.length - 1 ? [0, 6, 6, 0] : undefined} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          {ser.map((s, k) => (
            <linearGradient key={k} id={`g${uid}${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={0.35} /><stop offset="100%" stopColor={s.color} stopOpacity={0} /></linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="name" {...axis} interval="preserveStartEnd" minTickGap={18} />
        <YAxis allowDecimals={false} {...axis} />
        <Tooltip contentStyle={tip} formatter={(v) => fmt(v)} />
        {ser.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {ser.map((s, k) => <Area key={k} type="monotone" dataKey={`s${k}`} name={s.name} stroke={s.color} strokeWidth={2} fill={`url(#g${uid}${k})`} />)}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ChartCard({ c }: { c: ChartDef }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{c.title}</h3>
        {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
      </div>
      <div className="h-64 min-h-0 flex-1"><Body c={c} /></div>
    </Card>
  );
}