import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, Check, Menu, Sparkles, TrendingUp, Video, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { cn } from "@/lib/utils";
import { CATEGORIES, FAQ, MARQUEE, PERSONAS, STEPS } from "@/components/landing/landingData";
import { Accordion, AttendanceMock, CountUp, KanbanMock, LandingStyles, MeetingMock, Reveal, RolesMock, SectionHead } from "@/components/landing/landingParts";

const NAV: [string, string][] = [["features", "Features"], ["how", "How it works"], ["why", "Why Flowbase"], ["faq", "FAQ"]];

const SPOTLIGHTS = [
  {
    eyebrow: "Roles and permissions",
    title: "Give everyone exactly the access they need",
    points: [
      "Build custom roles with 80+ permissions across every module.",
      "What a person cannot do never shows up: no menu item, no tab, no button.",
      "Everything is enforced on the server as well, not only hidden on screen.",
      "Limit a role to the projects its people belong to, clone roles, and preview before saving.",
    ],
    visual: <RolesMock />,
  },
  {
    eyebrow: "Video meetings",
    title: "Meet without leaving your workspace",
    points: [
      "Share a link and join in the browser, with camera, microphone and screen sharing.",
      "Choose who can join: invited people only, the workspace, or anyone with the link.",
      "Waiting room, passcode and lock keep uninvited people out.",
      "Hosts can mute, remove, make co-hosts and end the meeting for everyone.",
    ],
    visual: <MeetingMock />,
  },
  {
    eyebrow: "Attendance and leave",
    title: "Attendance that is fair and automatic",
    points: [
      "Check in and out with a live timer. Late and half days follow rules you set once.",
      "A 1 to 5 star rating from attendance, punctuality and hours, never lowered by approved leave.",
      "Leave requests with quotas, balances and one-click approval.",
      "Download PDF and Excel reports for the team or for one person.",
    ],
    visual: <AttendanceMock />,
  },
];

const STATS: [number, string, string][] = [
  [20, "+", "project tools and views"],
  [80, "+", "permissions you can combine"],
  [8, "", "people in one video meeting"],
  [100, "", "people per CSV import"],
];

export default function Landing() {
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState("");
  const [cat, setCat] = useState(CATEGORIES[0].key);
  const current = CATEGORIES.find((c) => c.key === cat) || CATEGORIES[0];

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = document.documentElement;
        const max = h.scrollHeight - h.clientHeight;
        setScrolled(h.scrollTop > 8);
        setProgress(max > 0 ? h.scrollTop / max : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = NAV.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-40% 0px -55% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <LandingStyles />
      <div aria-hidden className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-primary" style={{ transform: `scaleX(${progress})` }} />

      {/* header */}
      <header className={cn("sticky top-0 z-50 border-b transition-all duration-300", scrolled ? "border-border bg-background/80 backdrop-blur-md" : "border-transparent bg-background")}>
        <div className="container flex h-16 items-center justify-between">
          <a href="#top" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Workflow className="h-4 w-4" /></div>
            <span className="text-lg font-semibold tracking-tight">Flowbase</span>
          </a>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={cn("rounded-full px-3.5 py-1.5 transition-colors", active === id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild><Link to="/login">Log in</Link></Button>
            <Button size="sm" asChild><Link to="/register">Get started</Link></Button>
            <button type="button" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary md:hidden">{menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        {menu && (
          <div className="lp-in border-t border-border bg-background md:hidden">
            <div className="container flex flex-col py-3">
              {NAV.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenu(false)} className="rounded-md px-2 py-2.5 text-sm hover:bg-secondary">{label}</a>)}
              <Link to="/login" className="rounded-md px-2 py-2.5 text-sm hover:bg-secondary">Log in</Link>
            </div>
          </div>
        )}
      </header>

      <main id="top">
        {/* hero */}
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: "linear-gradient(hsl(var(--border) / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.6) 1px, transparent 1px)", backgroundSize: "56px 56px", maskImage: "radial-gradient(ellipse at 50% 0%, black 25%, transparent 72%)", WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, black 25%, transparent 72%)" }} />
          <div aria-hidden className="lp-blob pointer-events-none absolute -left-24 top-10 -z-10 h-72 w-72 rounded-full bg-primary/25 blur-3xl" />
          <div aria-hidden className="lp-blob pointer-events-none absolute -right-24 top-40 -z-10 h-80 w-80 rounded-full bg-sky-500/20 blur-3xl" style={{ animationDelay: "-6s" }} />

          <div className="container pb-20 pt-16 text-center md:pb-28 md:pt-24">
            <a href="#why" className="lp-in inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15">
              <Sparkles className="h-3.5 w-3.5" /> New: video meetings with screen sharing, built in <ArrowRight className="h-3 w-3" />
            </a>
            <h1 className="lp-in mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl" style={{ animationDelay: "100ms" }}>
              Manage projects. Collaborate better.{" "}
              <span className="lp-grad bg-gradient-to-r from-primary via-sky-500 to-primary bg-[length:200%_auto] bg-clip-text text-transparent">Get work done.</span>
            </h1>
            <p className="lp-in mx-auto mt-5 max-w-2xl text-lg text-muted-foreground" style={{ animationDelay: "220ms" }}>
              Plan projects, manage tasks, chat, meet on video, track attendance and understand your productivity, all from one workspace.
            </p>
            <div className="lp-in mt-8 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "340ms" }}>
              <Button size="lg" className="shadow-lg shadow-primary/25" asChild><Link to="/register">Get started <ArrowRight className="h-4 w-4" /></Link></Button>
              <Button size="lg" variant="outline" asChild><a href="#features">See what's inside</a></Button>
            </div>
            <p className="lp-in mt-5 text-xs text-muted-foreground" style={{ animationDelay: "440ms" }}>Works in your browser · Invite your team by email or CSV · Roles you design yourself</p>

            <div className="lp-in relative mx-auto mt-16 max-w-4xl" style={{ animationDelay: "560ms" }}>
              <div aria-hidden className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-tr from-primary/25 via-transparent to-sky-500/20 blur-2xl" />
              <KanbanMock />
              <div aria-hidden className="lp-float absolute -left-4 top-12 hidden items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-xs shadow-xl md:flex">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600"><CalendarCheck className="h-4 w-4" /></span>
                <span><b className="block">Checked in 9:02 AM</b><span className="text-muted-foreground">On time · Office</span></span>
              </div>
              <div aria-hidden className="lp-float2 absolute -right-4 top-28 hidden items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-xs shadow-xl md:flex">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600"><Video className="h-4 w-4" /></span>
                <span><b className="block">Rahul joined the meeting</b><span className="text-muted-foreground">Design review</span></span>
              </div>
              <div aria-hidden className="lp-float absolute -bottom-5 left-12 hidden items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-xs shadow-xl md:flex" style={{ animationDelay: "-3s" }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600"><TrendingUp className="h-4 w-4" /></span>
                <span><b className="block">Sprint 12 · 82% done</b><span className="text-muted-foreground">On track to finish Friday</span></span>
              </div>
            </div>
          </div>
        </section>

        {/* marquee */}
        <section aria-hidden className="overflow-hidden border-y border-border bg-secondary/30 py-4">
          <div className="lp-marquee flex w-max gap-10 whitespace-nowrap text-sm font-medium text-muted-foreground">
            {[...MARQUEE, ...MARQUEE].map((m, i) => <span key={i} className="flex items-center gap-10">{m}<span className="h-1 w-1 rounded-full bg-primary/60" /></span>)}
          </div>
        </section>

        {/* stats */}
        <section className="container py-16">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map(([n, s, l], i) => (
              <Reveal key={l} delay={i * 90}>
                <div className="rounded-2xl border border-border bg-card p-6 text-center transition hover:border-primary/40 hover:shadow-md">
                  <p className="text-4xl font-semibold tracking-tight text-primary"><CountUp to={n} suffix={s} /></p>
                  <p className="mt-1 text-sm text-muted-foreground">{l}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* features */}
        <section id="features" className="container scroll-mt-20 pb-24">
          <SectionHead eyebrow="Features" title="Everything your team needs, in one place" sub="From the first task to the final release, plus the chat, meetings and attendance around it." />
          <Reveal>
            <div role="tablist" aria-label="Feature groups" className="mb-8 flex gap-2 overflow-x-auto pb-2 md:flex-wrap md:justify-center md:overflow-visible">
              {CATEGORIES.map((c) => (
                <button key={c.key} type="button" role="tab" aria-selected={cat === c.key} onClick={() => setCat(c.key)}
                  className={cn("flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all", cat === c.key ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                  <c.icon className="h-4 w-4" />{c.label}
                </button>
              ))}
            </div>
          </Reveal>
          <p key={`${cat}-blurb`} className="lp-in mx-auto mb-8 max-w-xl text-center text-sm text-muted-foreground">{current.blurb}</p>
          <div key={cat} role="tabpanel" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {current.items.map((f, i) => (
              <div key={f.title} className="lp-in group rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary"><f.icon className="h-5 w-5 text-primary transition-colors group-hover:text-primary-foreground" /></div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="scroll-mt-20 border-y border-border bg-secondary/30 py-24">
          <div className="container">
            <SectionHead eyebrow="How it works" title="Up and running in three steps" />
            <div className="relative mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
              <div aria-hidden className="absolute left-[16%] right-[16%] top-7 hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent md:block" />
              {STEPS.map((s, i) => (
                <Reveal key={s.title} delay={i * 140} className="text-center">
                  <div className="relative mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border-2 border-primary bg-background text-lg font-semibold text-primary shadow-lg shadow-primary/10">{i + 1}</div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{s.desc}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* spotlights */}
        <section id="why" className="container scroll-mt-20 space-y-24 py-24">
          {SPOTLIGHTS.map((s, i) => (
            <div key={s.title} className={cn("grid items-center gap-10 md:grid-cols-2 md:gap-16", i % 2 && "md:[&>*:first-child]:order-2")}>
              <Reveal from={i % 2 ? "right" : "left"}>
                <span className="inline-block rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{s.eyebrow}</span>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight">{s.title}</h2>
                <ul className="mt-6 space-y-3">
                  {s.points.map((p) => <li key={p} className="flex gap-3 text-sm text-muted-foreground"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15"><Check className="h-3 w-3 text-primary" /></span>{p}</li>)}
                </ul>
                <Button className="mt-7" asChild><Link to="/register">Try it with your team <ArrowRight className="h-4 w-4" /></Link></Button>
              </Reveal>
              <Reveal from="zoom" delay={120}><div className="relative"><div aria-hidden className="absolute -inset-3 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/15 to-transparent blur-xl" />{s.visual}</div></Reveal>
            </div>
          ))}
        </section>

        {/* built for */}
        <section className="border-y border-border bg-secondary/30 py-24">
          <div className="container">
            <SectionHead eyebrow="Built for" title="Made for teams that ship together" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PERSONAS.map((p, i) => (
                <Reveal key={p.title} delay={i * 90}>
                  <div className="h-full rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10"><p.icon className="h-5 w-5 text-primary" /></div>
                    <h3 className="font-semibold">{p.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{p.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="container scroll-mt-20 py-24">
          <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[1fr_1.6fr]">
            <Reveal from="left" className="lg:sticky lg:top-28 lg:self-start">
              <span className="inline-block rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">FAQ</span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">Questions, answered</h2>
              <p className="mt-3 text-muted-foreground">Everything people usually ask before setting up their workspace.</p>
              <Button variant="outline" className="mt-6" asChild><Link to="/register">Create a workspace</Link></Button>
            </Reveal>
            <Reveal delay={100}><Accordion items={FAQ} /></Reveal>
          </div>
        </section>

        {/* final call */}
        <section className="container pb-24">
          <Reveal from="zoom">
            <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-16 text-center text-primary-foreground md:px-12">
              <div aria-hidden className="lp-blob absolute -left-10 -top-10 h-56 w-56 rounded-full bg-white/15 blur-3xl" />
              <div aria-hidden className="lp-blob absolute -bottom-16 -right-10 h-64 w-64 rounded-full bg-black/15 blur-3xl" style={{ animationDelay: "-7s" }} />
              <div className="relative">
                <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">Bring your projects, your people and your meetings together</h2>
                <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">Set up your workspace in minutes and invite your team.</p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <Button size="lg" variant="secondary" asChild><Link to="/register">Get started <ArrowRight className="h-4 w-4" /></Link></Button>
                  <Button size="lg" variant="outline" className="border-white/40 bg-transparent text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" asChild><Link to="/login">Log in</Link></Button>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* footer */}
      <footer className="border-t border-border py-12">
        <div className="container grid gap-8 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"><Workflow className="h-4 w-4" /></div><span className="font-semibold">Flowbase</span></div>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">Projects, chat, meetings and attendance in one workspace. Built for teams that ship.</p>
          </div>
          <div>
            <p className="mb-3 text-sm font-medium">Product</p>
            <ul className="space-y-2 text-sm text-muted-foreground">{NAV.map(([id, l]) => <li key={id}><a href={`#${id}`} className="hover:text-foreground">{l}</a></li>)}</ul>
          </div>
          <div>
            <p className="mb-3 text-sm font-medium">Account</p>
            <ul className="space-y-2 text-sm text-muted-foreground"><li><Link to="/login" className="hover:text-foreground">Log in</Link></li><li><Link to="/register" className="hover:text-foreground">Get started</Link></li></ul>
          </div>
        </div>
        <div className="container mt-10 border-t border-border pt-6 text-center text-sm text-muted-foreground">© {new Date().getFullYear()} Flowbase. Built for teams that ship.</div>
      </footer>
    </div>
  );
}