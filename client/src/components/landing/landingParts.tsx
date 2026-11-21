import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Hand, LogOut, Mic, MonitorUp, PhoneOff, Star, Video } from "lucide-react";
import { cn } from "@/lib/utils";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PALETTE = ["#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#0891B2", "#CA8A04"];
const colorFor = (s: string) => PALETTE[(s.charCodeAt(0) + (s.charCodeAt(1) || 0)) % PALETTE.length];

/* ---------------------------------- styles ---------------------------------- */

export function LandingStyles() {
  return (
    <style>{`
      html { scroll-behavior: smooth; }
      @keyframes lp-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
      @keyframes lp-float2 { 0%,100% { transform: translateY(0) rotate(0deg) } 50% { transform: translateY(-6px) rotate(-1.2deg) } }
      @keyframes lp-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
      @keyframes lp-blob { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(40px,-30px) scale(1.12) } }
      @keyframes lp-ring { 0% { box-shadow: 0 0 0 0 hsl(var(--primary) / .55) } 100% { box-shadow: 0 0 0 12px hsl(var(--primary) / 0) } }
      @keyframes lp-fade { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
      @keyframes lp-pop { from { opacity: 0; transform: scale(.85) } to { opacity: 1; transform: none } }
      @keyframes lp-grad { 0% { background-position: 0% 50% } 100% { background-position: 200% 50% } }
      .lp-float { animation: lp-float 6s ease-in-out infinite }
      .lp-float2 { animation: lp-float2 7s ease-in-out infinite }
      .lp-marquee { animation: lp-marquee 38s linear infinite }
      .lp-marquee:hover { animation-play-state: paused }
      .lp-blob { animation: lp-blob 14s ease-in-out infinite }
      .lp-ring { animation: lp-ring 1.6s ease-out infinite }
      .lp-in { animation: lp-fade .8s cubic-bezier(.2,.7,.2,1) both }
      .lp-pop { animation: lp-pop .5s cubic-bezier(.2,.8,.3,1.2) both }
      .lp-grad { animation: lp-grad 6s linear infinite }
      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto }
        .lp-float, .lp-float2, .lp-marquee, .lp-blob, .lp-ring, .lp-in, .lp-pop, .lp-grad { animation: none !important }
      }
    `}</style>
  );
}

/* ------------------------------- scroll reveal ------------------------------- */

export function Reveal({ children, delay = 0, from = "up", className }: { children: ReactNode; delay?: number; from?: "up" | "left" | "right" | "zoom"; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || reducedMotion()) { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const hidden = from === "up" ? "translate-y-8" : from === "left" ? "-translate-x-8" : from === "right" ? "translate-x-8" : "scale-95";
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }} className={cn("transition-all duration-700 ease-out", shown ? "translate-x-0 translate-y-0 scale-100 opacity-100" : `opacity-0 ${hidden}`, className)}>
      {children}
    </div>
  );
}

export function CountUp({ to, suffix = "", duration = 1400 }: { to: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || reducedMotion()) { setV(to); return; }
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, duration]);
  return <span ref={ref}>{v}{suffix}</span>;
}

export function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: string }) {
  return (
    <Reveal className="mx-auto mb-12 max-w-2xl text-center">
      <span className="inline-block rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{eyebrow}</span>
      <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-muted-foreground">{sub}</p>}
    </Reveal>
  );
}

/* ----------------------------------- FAQ ----------------------------------- */

export function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-3">
      {items.map((it, i) => {
        const o = open === i;
        return (
          <div key={it.q} className={cn("rounded-xl border bg-card transition-colors", o ? "border-primary/40 shadow-sm" : "border-border hover:border-primary/20")}>
            <button type="button" id={`faq-btn-${i}`} aria-expanded={o} aria-controls={`faq-panel-${i}`} onClick={() => setOpen(o ? null : i)} className="flex w-full items-center justify-between gap-4 rounded-xl px-5 py-4 text-left font-medium">
              {it.q}
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300", o && "rotate-180 text-primary")} />
            </button>
            <div id={`faq-panel-${i}`} role="region" aria-labelledby={`faq-btn-${i}`} className={cn("grid transition-[grid-template-rows] duration-300 ease-out", o ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <div className="overflow-hidden"><p className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">{it.a}</p></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------- mockups ---------------------------------- */

const COLS = [
  { name: "To do", dot: "bg-slate-400", cards: [
    { t: "Design onboarding flow", tag: "Feature", c: "bg-violet-500/15 text-violet-600 dark:text-violet-300", who: ["A", "R"] },
    { t: "Fix login redirect", tag: "Bug", c: "bg-red-500/15 text-red-600 dark:text-red-300", who: ["M"] },
  ] },
  { name: "In progress", dot: "bg-blue-500", cards: [
    { t: "API rate limits", tag: "Task", c: "bg-blue-500/15 text-blue-600 dark:text-blue-300", who: ["R"], drag: true },
    { t: "Sprint report export", tag: "Feature", c: "bg-violet-500/15 text-violet-600 dark:text-violet-300", who: ["A"] },
  ] },
  { name: "Done", dot: "bg-emerald-500", cards: [
    { t: "Roles and permissions", tag: "Feature", c: "bg-violet-500/15 text-violet-600 dark:text-violet-300", who: ["M", "A"] },
    { t: "Release 1.4 notes", tag: "Task", c: "bg-blue-500/15 text-blue-600 dark:text-blue-300", who: ["R"] },
  ] },
];

export function KanbanMock({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("overflow-hidden rounded-2xl border border-border bg-card text-left shadow-2xl", className)}>
      <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <div className="mx-auto rounded-md bg-background px-3 py-0.5 text-[11px] text-muted-foreground">Flowbase · Sprint 12 · Board</div>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3 sm:gap-3 sm:p-4">
        {COLS.map((col) => (
          <div key={col.name} className="rounded-xl bg-secondary/40 p-2 sm:p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium sm:text-xs">
              <span className={cn("h-2 w-2 rounded-full", col.dot)} />{col.name}<span className="ml-auto text-muted-foreground">{col.cards.length}</span>
            </div>
            <div className="space-y-2">
              {col.cards.map((c) => (
                <div key={c.t} className={cn("rounded-lg border border-border bg-card p-2 shadow-sm sm:p-2.5", c.drag && "lp-float2 border-primary/50 shadow-lg")}>
                  <p className="text-[10px] font-medium leading-snug sm:text-xs">{c.t}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-medium sm:text-[10px]", c.c)}>{c.tag}</span>
                    <div className="flex -space-x-1.5">
                      {c.who.map((w) => <span key={w} className="flex h-4 w-4 items-center justify-center rounded-full border border-card text-[8px] font-semibold text-white" style={{ background: colorFor(w) }}>{w}</span>)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const PEOPLE = [{ n: "Asha", speaking: true }, { n: "Rahul" }, { n: "Meera" }];

export function MeetingMock() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 p-3 text-white shadow-2xl">
      <div className="mb-2 flex items-center justify-between px-1 text-xs"><span className="font-medium">Design review</span><span className="text-white/50">23:14 · 4 people</span></div>
      <div className="relative h-36 overflow-hidden rounded-xl bg-neutral-800 p-3 sm:h-44">
        <div className="mb-2 flex gap-1.5"><span className="h-2 w-2 rounded-full bg-white/30" /><span className="h-2 w-2 rounded-full bg-white/30" /></div>
        <div className="space-y-2">
          <div className="h-2.5 w-2/3 rounded bg-white/25" /><div className="h-2.5 w-1/2 rounded bg-white/15" />
          <div className="mt-3 grid grid-cols-3 gap-2"><div className="h-12 rounded bg-primary/40" /><div className="h-12 rounded bg-white/10" /><div className="h-12 rounded bg-white/10" /></div>
        </div>
        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-[10px]"><MonitorUp className="h-3 w-3" /> Asha's screen</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {PEOPLE.map((p) => (
          <div key={p.n} className={cn("relative flex h-16 items-center justify-center rounded-xl bg-neutral-800", p.speaking && "lp-ring ring-2 ring-emerald-400")}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold" style={{ background: colorFor(p.n) }}>{p.n[0]}</span>
            <span className="absolute bottom-1 left-1.5 text-[10px] text-white/70">{p.n}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        {[Mic, Video, MonitorUp, Hand].map((I, i) => <span key={i} className={cn("flex h-9 w-9 items-center justify-center rounded-full", i === 2 ? "bg-white text-neutral-900" : "bg-white/10")}><I className="h-4 w-4" /></span>)}
        <span className="flex h-9 w-12 items-center justify-center rounded-full bg-red-600"><PhoneOff className="h-4 w-4" /></span>
      </div>
    </div>
  );
}

const ROLE_ROWS: { m: string; a: [string, boolean][] }[] = [
  { m: "Projects", a: [["View", true], ["Create", false], ["Edit", true], ["Delete", false]] },
  { m: "Tasks", a: [["View", true], ["Create", true], ["Edit", true], ["Assign", false]] },
  { m: "Bugs", a: [["View", true], ["Report", true], ["Edit", true], ["Delete", false]] },
  { m: "Attendance", a: [["View", true], ["Check in", true], ["Team", false], ["Settings", false]] },
];
const MENU: [string, boolean][] = [["Dashboard", true], ["Projects", true], ["Tasks", true], ["Meetings", true], ["Analytics", false], ["Roles", false]];

export function RolesMock() {
  let n = 0;
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-border bg-card p-5 text-left shadow-xl">
      <div className="mb-4 flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-pink-500" /><p className="font-semibold">QA Lead</p><span className="ml-auto rounded-md bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">Custom role</span></div>
      <div className="space-y-3">
        {ROLE_ROWS.map((r) => (
          <div key={r.m}>
            <p className="mb-1.5 text-xs font-medium">{r.m}</p>
            <div className="flex flex-wrap gap-1.5">
              {r.a.map(([label, on]) => (
                <span key={label} style={{ animationDelay: `${n++ * 60}ms` }} className={cn("lp-pop inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]", on ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground line-through")}>
                  {on && <Check className="h-3 w-3" />}{label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-secondary/50 p-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">This person's menu</p>
        <div className="flex flex-wrap gap-1.5">
          {MENU.map(([label, on]) => <span key={label} className={cn("rounded-md px-2 py-1 text-[11px]", on ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground/60 line-through")}>{on ? label : `${label} (hidden)`}</span>)}
        </div>
      </div>
    </div>
  );
}

const DAYS = "PPPPPWWPLPPAWWPPVVHWWPPPPPWW".split("").reduce<string[]>((a, c, i, s) => (c === "L" && s[i - 1] === "P" && a[a.length - 1] === "P" ? a : a.concat(c)), []);
const DAY_CLS: Record<string, string> = { P: "bg-emerald-500/70", L: "bg-amber-400", A: "bg-red-500/80", V: "bg-sky-500/70", H: "bg-violet-500/70", W: "bg-muted" };

export function AttendanceMock() {
  const [s, setS] = useState(24120);
  useEffect(() => { const i = setInterval(() => setS((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-border bg-card p-5 text-left shadow-xl">
      <div className="flex items-start justify-between">
        <div><p className="text-xs text-muted-foreground">Today · shift 09:00 to 18:00</p><p className="font-mono text-3xl font-semibold tabular-nums">{p(Math.floor(s / 3600))}:{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}</p></div>
        <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-300">Working</span>
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 rounded-full border border-red-500/40 py-2 text-sm font-medium text-red-600 dark:text-red-400"><LogOut className="h-4 w-4" /> Check out</div>
      <div className="mt-4 flex items-center gap-3 rounded-xl bg-secondary/50 p-3">
        <div className="flex">{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn("h-5 w-5", i <= 4 ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />)}</div>
        <div><p className="text-sm font-semibold">Very good</p><p className="text-[11px] text-muted-foreground">Score 91 · attendance 96% · punctuality 88%</p></div>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {DAYS.slice(0, 28).map((c, i) => <span key={i} className={cn("lp-pop aspect-square rounded-md", DAY_CLS[c] || "bg-muted")} style={{ animationDelay: `${i * 25}ms` }} />)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {[["bg-emerald-500/70", "Present"], ["bg-amber-400", "Late"], ["bg-red-500/80", "Absent"], ["bg-sky-500/70", "Leave"], ["bg-violet-500/70", "Holiday"]].map(([c, l]) => <span key={l} className="flex items-center gap-1"><span className={cn("h-2 w-2 rounded-sm", c)} />{l}</span>)}
      </div>
    </div>
  );
}