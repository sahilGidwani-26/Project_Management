import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Briefcase, Building2, CheckCircle2, ExternalLink, Globe, Loader2, Mail, MapPin, Phone, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceMembers } from "@/hooks/useProject";
import { MemberDetail } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { RoleBadge } from "@/components/people/peopleUi";
import { AboutTab, CompanyTab, WorkTab } from "@/components/profile/ProfileTabs";
import { PhotoUploader } from "@/components/profile/PhotoUploader";
import type { CompanyData, ProfileData } from "@/components/profile/profileTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatDate } from "@/lib/utils";

const SOCIAL_LABEL: Record<string, string> = { linkedin: "LinkedIn", github: "GitHub", twitter: "X", instagram: "Instagram" };

export default function Profile() {
  const { workspaceId } = useParams();
  const w = workspaceId!;
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { refetchUser } = useAuth();
  const perm = usePermissions();
  const { refetch: refetchWorkspaces } = useWorkspace();
  const { data: members } = useWorkspaceMembers(w);
  const [sending, setSending] = useState(false);

  const { data: p } = useQuery({ queryKey: ["profile"], queryFn: async () => (await api.get("/profile")).data.data as ProfileData });
  const { data: detail } = useQuery({
    queryKey: ["member", w, perm.memberId],
    queryFn: async () => (await api.get(`/workspaces/${w}/members/${perm.memberId}`)).data.data as MemberDetail,
    enabled: !!perm.memberId,
  });
  const { data: co } = useQuery({ queryKey: ["company", w], queryFn: async () => (await api.get(`/workspaces/${w}/company`)).data.data as CompanyData });

  const employer = perm.isOwner || perm.can("workspace.edit");
  const tab = ["about", "work", "company"].includes(sp.get("tab") || "") ? (sp.get("tab") as string) : "about";
  const go = (t: string) => setSp({ tab: t }, { replace: true });

  const afterProfile = (np: ProfileData) => {
    qc.setQueryData(["profile"], np);
    refetchUser();
    qc.invalidateQueries({ queryKey: ["members", w] });
    qc.invalidateQueries({ queryKey: ["team-members", w] });
  };
  const afterCompany = (c: CompanyData) => { qc.setQueryData(["company", w], c); refetchWorkspaces(); };

  if (!p) return <div><PageHeader title="My profile" /><div className="space-y-4 p-6"><Skeleton className="h-56" /><Skeleton className="h-72" /></div></div>;

  const checks: [string, boolean, string][] = [
    ["Add a profile photo", !!p.profileImage, "about"], ["Write who you are", !!p.jobTitle, "about"], ["Write a short bio", !!p.bio, "about"], ["Add your mobile number", !!p.phone, "about"],
    ["Add your city and country", !!(p.city || p.country), "about"], ["Add a website or social link", !!(p.website || Object.values(p.social || {}).some(Boolean)), "about"], ["Verify your email", p.emailVerified, "about"],
  ];
  const done = checks.filter((c) => c[1]).length;
  const pct = Math.round((done / checks.length) * 100);
  const social = Object.entries(p.social || {}).filter(([, v]) => v);

  const verify = async () => {
    setSending(true);
    try { await api.post("/profile/resend-verification"); toast.success("Verification email sent. Check your inbox."); } catch (e) { toast.error(apiError(e)); }
    setSending(false);
  };

  const tabs = [["about", "About me", true], ["work", "Work", true], ["company", employer ? "Company" : "Our company", true]] as const;

  return (
    <div>
      <PageHeader title="My profile" description="How you appear to your team" />
      <div className="space-y-6 p-4 md:p-6">
        {/* header */}
        <Card className="overflow-hidden">
          <div className="h-28 bg-gradient-to-r from-primary via-primary/70 to-sky-500/70 md:h-32" />
          <CardContent className="px-5 pb-5 md:px-7">
            <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
              <PhotoUploader
                src={p.profileImage} name={p.name} sizeClass="h-24 w-24 ring-4 ring-background md:h-28 md:w-28"
                onSave={async (image) => { const r = await api.put("/profile/photo", { image }); afterProfile(r.data.data); toast.success("Photo saved"); }}
                onRemove={async () => { const r = await api.delete("/profile/photo"); afterProfile(r.data.data); toast.success("Photo removed"); }}
              />
              <Button variant="outline" size="sm" onClick={() => go("about")}>Edit profile</Button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold tracking-tight">{p.name}</h2>
                  <RoleBadge role={perm.legacyRole || "MEMBER"} name={perm.roleName} color={perm.roleColor} />
                  <Badge variant="outline" className="gap-1 text-[11px]">{employer ? <Briefcase className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}{employer ? "Employer" : "Employee"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{[p.jobTitle, co?.workspace.name].filter(Boolean).join(" at ") || "Add your headline"}</p>
              </div>
              {p.bio && <p className="max-w-2xl whitespace-pre-wrap text-sm">{p.bio}</p>}

              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><Mail className="h-4 w-4" />{p.email}{p.emailVerified ? <BadgeCheck className="h-4 w-4 text-emerald-500" aria-label="Verified" /> : <button type="button" disabled={sending} onClick={verify} className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 hover:underline">{sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldAlert className="h-3 w-3" />}Verify</button>}</span>
                {p.phone && <span className="flex items-center gap-1.5"><Phone className="h-4 w-4" />{p.phone}</span>}
                {(p.city || p.country) && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{[p.city, p.country].filter(Boolean).join(", ")}</span>}
                {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-foreground"><Globe className="h-4 w-4" />{p.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>}
              </div>
              {social.length > 0 && <div className="flex flex-wrap gap-2">{social.map(([k, v]) => <a key={k} href={v as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">{SOCIAL_LABEL[k]}<ExternalLink className="h-3 w-3" /></a>)}</div>}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-4">
            <div className="inline-flex rounded-md border border-border p-0.5">
              {tabs.map(([k, l]) => <button key={k} type="button" onClick={() => go(k)} className={cn("rounded px-4 py-1.5 text-sm font-medium", tab === k ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{l}</button>)}
            </div>
            {tab === "about" && <AboutTab p={p} onSaved={afterProfile} />}
            {tab === "work" && <WorkTab detail={detail} members={members || []} workspaceId={w} onSaved={() => { qc.invalidateQueries({ queryKey: ["member", w] }); qc.invalidateQueries({ queryKey: ["team-members", w] }); }} />}
            {tab === "company" && (co ? <CompanyTab co={co} workspaceId={w} onChanged={afterCompany} /> : <Skeleton className="h-72" />)}
          </div>

          <div className="space-y-4">
            <Card><CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between"><h3 className="font-medium">Profile strength</h3><span className="text-sm font-semibold">{pct}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} /></div>
              {pct === 100 ? <p className="flex items-center gap-1.5 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Your profile is complete.</p> : (
                <ul className="space-y-1.5 text-sm">{checks.filter((c) => !c[1]).map(([t, , target]) => <li key={t}><button type="button" onClick={() => go(target)} className="text-left text-muted-foreground hover:text-primary">+ {t}</button></li>)}</ul>
              )}
            </CardContent></Card>

            <Card><CardContent className="space-y-1 p-5 text-sm">
              <h3 className="mb-2 font-medium">At a glance</h3>
              <div className="flex justify-between"><span className="text-muted-foreground">Member since</span><span>{formatDate(p.createdAt)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Last login</span><span>{p.lastLoginAt ? formatDate(p.lastLoginAt) : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Timezone</span><span>{p.timezone}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Role here</span><span>{perm.roleName}</span></div>
              <Button asChild variant="outline" size="sm" className="mt-3 w-full"><Link to={`/app/${w}/settings`}>Account settings</Link></Button>
            </CardContent></Card>
          </div>
        </div>
      </div>
    </div>
  );
}