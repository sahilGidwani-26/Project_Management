import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CalendarCheck, Check, KanbanSquare, ShieldCheck, TrendingUp, Video, Workflow } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { LandingStyles } from "@/components/landing/landingParts";
import { cn } from "@/lib/utils";

const SLIDES = [
  { icon: KanbanSquare, title: "Plan work and ship faster", text: "Kanban, sprints, bugs, releases and a delivery forecast you can trust." },
  { icon: Video, title: "Meet without leaving the app", text: "Video meetings with screen sharing, and a waiting room for guests." },
  { icon: CalendarCheck, title: "Attendance that is fair", text: "One-tap check-in, leave, star ratings and PDF or Excel reports." },
  { icon: ShieldCheck, title: "Roles you design yourself", text: "Give each person exactly the access they need. The rest stays hidden." },
];
const POINTS = ["Invite your team by email or CSV", "Set up in minutes, works in the browser", "Your data stays in your workspace"];

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 5000);
    return () => clearInterval(t);
  }, []);
  const S = SLIDES[i];

  return (
    <div className="flex min-h-screen bg-background">
      <LandingStyles />

      {/* brand panel */}
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:w-[46%] xl:w-1/2">
        <div aria-hidden className="absolute inset-0 opacity-30" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.18) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "radial-gradient(ellipse at 30% 20%, black 20%, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse at 30% 20%, black 20%, transparent 75%)" }} />
        <div aria-hidden className="lp-blob absolute -left-20 top-10 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
        <div aria-hidden className="lp-blob absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-black/20 blur-3xl" style={{ animationDelay: "-7s" }} />

        <div className="relative z-10 flex w-full flex-col justify-between p-10 xl:p-14">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20 backdrop-blur"><Workflow className="h-5 w-5" /></span>
            <span className="text-lg font-semibold tracking-tight">Flowbase</span>
          </Link>

          <div className="max-w-md">
            <div key={i} className="lp-in min-h-[11rem]">
              <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur"><S.icon className="h-6 w-6" /></span>
              <h2 className="text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">{S.title}</h2>
              <p className="mt-3 text-primary-foreground/80">{S.text}</p>
            </div>
            <div className="mt-2 flex gap-1.5">
              {SLIDES.map((_, k) => <button key={k} type="button" aria-label={`Slide ${k + 1}`} onClick={() => setI(k)} className={cn("h-1.5 rounded-full transition-all", k === i ? "w-8 bg-white" : "w-1.5 bg-white/40")} />)}
            </div>
            <ul className="mt-8 space-y-2.5 text-sm">
              {POINTS.map((p) => <li key={p} className="flex items-center gap-2.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20"><Check className="h-3 w-3" /></span>{p}</li>)}
            </ul>
          </div>

          <div aria-hidden className="relative h-28">
            <div className="lp-float absolute left-0 top-0 flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs backdrop-blur">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20"><CalendarCheck className="h-4 w-4" /></span>
              <span><b className="block">Checked in 9:02 AM</b><span className="text-primary-foreground/70">On time · Office</span></span>
            </div>
            <div className="lp-float2 absolute left-40 top-10 flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs backdrop-blur xl:left-56">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20"><TrendingUp className="h-4 w-4" /></span>
              <span><b className="block">Sprint 12 · 82% done</b><span className="text-primary-foreground/70">On track for Friday</span></span>
            </div>
          </div>
        </div>
      </aside>

      {/* form side */}
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to home</Link>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center px-5 pb-10 sm:px-8">
          <div className="lp-in w-full max-w-md">
            <div className="mb-7">
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 lg:hidden"><Workflow className="h-5 w-5" /></span>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {children}
            {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}