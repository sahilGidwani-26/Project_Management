import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, ExternalLink, Globe, Loader2, Mail, MapPin, Pencil, Phone } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { MemberDetail, WorkspaceMember } from "@/types";
import { EditProfileDialog } from "@/components/people/EditProfileDialog";
import { Field } from "@/components/common/FormDialog";
import { AField, COMPANY_SIZES, CountryList, INDUSTRIES, PhoneInput, phoneOk, selectCls } from "@/components/auth/authUi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { employmentLabel } from "@/lib/people";
import { formatDate, cn } from "@/lib/utils";
import { PhotoUploader } from "./PhotoUploader";
import type { CompanyData, ProfileData } from "./profileTypes";

const Row = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0"><span className="shrink-0 text-muted-foreground">{label}</span><span className="text-right">{value || "—"}</span></div>
);

const SOCIALS = [["linkedin", "LinkedIn", "linkedin.com/in/your-name"], ["github", "GitHub", "github.com/your-name"], ["twitter", "X (Twitter)", "x.com/your-name"], ["instagram", "Instagram", "instagram.com/your-name"]] as const;

/* ---------------------------------- about ---------------------------------- */

export function AboutTab({ p, onSaved }: { p: ProfileData; onSaved: (p: ProfileData) => void }) {
  const init = useMemo(() => ({
    name: p.name, jobTitle: p.jobTitle, bio: p.bio, phone: p.phone, city: p.city, country: p.country, website: p.website,
    linkedin: p.social?.linkedin || "", github: p.social?.github || "", twitter: p.social?.twitter || "", instagram: p.social?.instagram || "",
  }), [p]);
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(init), [init]);
  const set = (k: keyof typeof init, v: string) => setF((s) => ({ ...s, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(init);

  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Your name must be at least 2 characters");
    if (f.phone && !phoneOk(f.phone)) return toast.error("The phone number looks wrong");
    setBusy(true);
    try {
      const res = await api.put("/profile", { name: f.name, jobTitle: f.jobTitle, bio: f.bio, phone: f.phone, city: f.city, country: f.country, website: f.website, social: { linkedin: f.linkedin, github: f.github, twitter: f.twitter, instagram: f.instagram } });
      onSaved(res.data.data);
      toast.success("Profile saved");
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <CountryList />
      <Card><CardContent className="space-y-4 p-5">
        <h3 className="font-medium">Basic details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <AField id="pn" label="Full name"><Input id="pn" value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} /></AField>
          <AField id="pj" label="Headline or job title"><Input id="pj" value={f.jobTitle} maxLength={100} onChange={(e) => set("jobTitle", e.target.value)} placeholder="Founder & CEO" /></AField>
          <AField id="pe" label="Email" hint="Your login email cannot be changed here."><Input id="pe" value={p.email} disabled /></AField>
          <AField id="pp" label="Mobile number"><PhoneInput id="pp" value={f.phone} onChange={(v) => set("phone", v)} /></AField>
          <AField id="pc" label="City"><Input id="pc" value={f.city} maxLength={80} onChange={(e) => set("city", e.target.value)} /></AField>
          <AField id="pco" label="Country"><Input id="pco" list="country-list" value={f.country} maxLength={80} onChange={(e) => set("country", e.target.value)} /></AField>
        </div>
        <AField id="pb" label="About you" hint={`${f.bio.length}/500`}><Textarea id="pb" rows={4} value={f.bio} maxLength={500} onChange={(e) => set("bio", e.target.value)} placeholder="A short introduction your team will see" /></AField>
      </CardContent></Card>

      <Card><CardContent className="space-y-4 p-5">
        <div><h3 className="font-medium">Links</h3><p className="text-xs text-muted-foreground">Paste a link or just your username.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <AField id="pw" label="Website"><Input id="pw" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="yourwebsite.com" /></AField>
          {SOCIALS.map(([k, label, ph]) => <AField key={k} id={`s-${k}`} label={label}><Input id={`s-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} /></AField>)}
        </div>
      </CardContent></Card>

      <div className="flex items-center justify-end gap-2">
        {dirty && <Button variant="ghost" onClick={() => setF(init)}>Discard</Button>}
        <Button disabled={!dirty || busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save profile</Button>
      </div>
    </div>
  );
}

/* ----------------------------------- work ----------------------------------- */

export function WorkTab({ detail, members, workspaceId, onSaved }: { detail?: MemberDetail; members: WorkspaceMember[]; workspaceId: string; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  if (!detail) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading your work profile…</CardContent></Card>;
  const m = detail.member;
  const prof = m.profile;
  const pers = detail.personal;
  const a = pers?.address;
  const address = [a?.line1, a?.line2, a?.city, a?.state, a?.postalCode, a?.country].filter(Boolean).join(", ");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">Work details</h3>{detail.permissions.canEdit && <Button size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}</div>
          <Row label="Designation" value={prof?.designation || m.userId.jobTitle} />
          <Row label="Department" value={prof?.department} />
          <Row label="Company" value={prof?.company} />
          <Row label="Employment type" value={employmentLabel(prof?.employmentType)} />
          <Row label="Employee ID" value={prof?.employeeId} />
          <Row label="Work location" value={prof?.workLocation} />
          <Row label="Reports to" value={detail.reportingManager?.name} />
          <Row label="Joined" value={m.joinedAt ? formatDate(m.joinedAt) : undefined} />
          <div className="pt-3"><p className="mb-1.5 text-sm text-muted-foreground">Skills</p><div className="flex flex-wrap gap-1.5">{prof?.skills?.length ? prof.skills.map((s) => <Badge key={s} variant="secondary">{s}</Badge>) : <span className="text-sm">—</span>}</div></div>
          {!detail.permissions.canEditAllFields && <p className="mt-3 text-xs text-muted-foreground">Designation, department and similar details are set by your admin. You can edit your work location, skills and private details.</p>}
        </CardContent></Card>

        {pers && (
          <Card><CardContent className="p-5">
            <h3 className="font-medium">Private details</h3>
            <p className="mb-2 text-xs text-muted-foreground">🔒 Only you and people with the “private details” permission can see this.</p>
            <Row label="Phone" value={pers.phone} />
            <Row label="Alternate phone" value={pers.alternatePhone} />
            <Row label="Date of birth" value={pers.dateOfBirth ? formatDate(pers.dateOfBirth) : undefined} />
            <Row label="Address" value={address} />
            <Row label="Emergency contact" value={pers.emergencyContact?.name ? `${pers.emergencyContact.name}${pers.emergencyContact.relation ? ` (${pers.emergencyContact.relation})` : ""}${pers.emergencyContact.phone ? `, ${pers.emergencyContact.phone}` : ""}` : undefined} />
          </CardContent></Card>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Your attendance, tasks and progress are under <Link className="text-primary hover:underline" to={`/app/${workspaceId}/attendance`}>Attendance</Link> and <Link className="text-primary hover:underline" to={`/app/${workspaceId}/team/me`}>Team</Link>.</p>
      <EditProfileDialog open={edit} onOpenChange={setEdit} workspaceId={workspaceId} detail={detail} members={members} onSaved={onSaved} />
    </div>
  );
}

/* ---------------------------------- company ---------------------------------- */

export function CompanyTab({ co, workspaceId, onChanged }: { co: CompanyData; workspaceId: string; onChanged: (c: CompanyData) => void }) {
  const c = co.company || {};
  const init = useMemo(() => ({
    name: co.workspace.name, description: co.workspace.description, legalName: c.legalName || "", industry: c.industry || "", size: c.size || "", website: c.website || "",
    phone: c.phone || "", email: c.email || "", taxId: c.taxId || "", foundedYear: c.foundedYear ? String(c.foundedYear) : "",
    line1: c.address?.line1 || "", line2: c.address?.line2 || "", city: c.address?.city || "", state: c.address?.state || "", country: c.address?.country || "", postalCode: c.address?.postalCode || "",
  }), [co, c]);
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(init), [init]);
  const set = (k: keyof typeof init, v: string) => setF((s) => ({ ...s, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const base = `/workspaces/${workspaceId}`;

  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Enter the company name");
    if (f.phone && !phoneOk(f.phone)) return toast.error("The company phone number looks wrong");
    setBusy(true);
    try {
      const res = await api.put(`${base}/company`, {
        name: f.name, description: f.description,
        company: { legalName: f.legalName, industry: f.industry, size: f.size, website: f.website, phone: f.phone, email: f.email, taxId: f.taxId, foundedYear: f.foundedYear, address: { line1: f.line1, line2: f.line2, city: f.city, state: f.state, country: f.country, postalCode: f.postalCode } },
      });
      onChanged(res.data.data);
      toast.success("Company details saved");
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };

  const logo = (
    <PhotoUploader
      src={co.workspace.logo} name={co.workspace.name} shape="square" sizeClass="h-24 w-24" noun="logo" canEdit={co.canEdit}
      onSave={async (image) => { const r = await api.put(`${base}/logo`, { image }); onChanged(r.data.data); toast.success("Logo saved"); }}
      onRemove={async () => { const r = await api.delete(`${base}/logo`); onChanged(r.data.data); toast.success("Logo removed"); }}
    />
  );

  const owner = co.owner && (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <PhotoUploader src={co.owner.profileImage} name={co.owner.name} sizeClass="h-11 w-11" canEdit={false} onSave={async () => undefined} />
      <div className="min-w-0 text-sm"><p className="text-xs text-muted-foreground">Owner</p><p className="truncate font-medium">{co.owner.name}</p><p className="truncate text-xs text-muted-foreground">{[co.owner.jobTitle, co.owner.email, co.owner.phone].filter(Boolean).join(" · ")}</p></div>
    </div>
  );

  /* people who cannot edit see a clean read-only card */
  if (!co.canEdit) {
    return (
      <Card><CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-center gap-5">
          {logo}
          <div className="min-w-0"><h3 className="text-xl font-semibold">{co.workspace.name}</h3>{co.workspace.description && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{co.workspace.description}</p>}<p className="mt-2 text-xs text-muted-foreground">{co.memberCount} people · since {formatDate(co.workspace.createdAt)}</p></div>
        </div>
        <div className="grid gap-x-8 sm:grid-cols-2">
          <Row label="Industry" value={c.industry} /><Row label="Team size" value={c.size} />
          <Row label="Website" value={c.website ? <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{c.website.replace(/^https?:\/\//, "")}</a> : undefined} />
          <Row label="Founded" value={c.foundedYear} />
        </div>
        {owner}
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <CountryList />
      <Card><CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start gap-6">
          {logo}
          <div className="min-w-0 flex-1 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <AField id="cn" label="Company or workspace name"><Input id="cn" value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} /></AField>
              <AField id="cl" label="Legal name (optional)"><Input id="cl" value={f.legalName} maxLength={120} onChange={(e) => set("legalName", e.target.value)} placeholder="Acme Technologies Pvt Ltd" /></AField>
            </div>
            <AField id="cd" label="About the company" hint={`${f.description.length}/300`}><Textarea id="cd" rows={3} value={f.description} maxLength={300} onChange={(e) => set("description", e.target.value)} /></AField>
          </div>
        </div>
        {owner}
      </CardContent></Card>

      <Card><CardContent className="space-y-4 p-5">
        <h3 className="font-medium">Company details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <AField id="ci" label="Industry"><select id="ci" className={cn(selectCls, "w-full")} value={f.industry} onChange={(e) => set("industry", e.target.value)}><option value="">Not set</option>{[...(f.industry && !INDUSTRIES.includes(f.industry) ? [f.industry] : []), ...INDUSTRIES].map((i) => <option key={i}>{i}</option>)}</select></AField>
          <AField id="cs" label="Team size"><select id="cs" className={cn(selectCls, "w-full")} value={f.size} onChange={(e) => set("size", e.target.value)}><option value="">Not set</option>{COMPANY_SIZES.map((i) => <option key={i}>{i}</option>)}</select></AField>
          <AField id="cw" label="Website"><Input id="cw" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="acme.com" /></AField>
          <AField id="cf" label="Founded in"><Input id="cf" inputMode="numeric" value={f.foundedYear} maxLength={4} onChange={(e) => set("foundedYear", e.target.value.replace(/\D/g, ""))} placeholder="2020" /></AField>
          <AField id="cp" label="Company phone"><PhoneInput id="cp" value={f.phone} onChange={(v) => set("phone", v)} /></AField>
          <AField id="cm" label="Company email"><Input id="cm" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="hello@acme.com" /></AField>
          <AField id="ct" label="Tax ID (GST, VAT…)"><Input id="ct" value={f.taxId} maxLength={30} onChange={(e) => set("taxId", e.target.value)} /></AField>
        </div>
      </CardContent></Card>

      <Card><CardContent className="space-y-4 p-5">
        <h3 className="font-medium">Address</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <AField id="a1" label="Address line 1"><Input id="a1" value={f.line1} onChange={(e) => set("line1", e.target.value)} /></AField>
          <AField id="a2" label="Address line 2"><Input id="a2" value={f.line2} onChange={(e) => set("line2", e.target.value)} /></AField>
          <AField id="ac" label="City"><Input id="ac" value={f.city} onChange={(e) => set("city", e.target.value)} /></AField>
          <AField id="as" label="State"><Input id="as" value={f.state} onChange={(e) => set("state", e.target.value)} /></AField>
          <AField id="ao" label="Country"><Input id="ao" list="country-list" value={f.country} onChange={(e) => set("country", e.target.value)} /></AField>
          <AField id="az" label="Postal code"><Input id="az" value={f.postalCode} maxLength={20} onChange={(e) => set("postalCode", e.target.value)} /></AField>
        </div>
        <p className="text-xs text-muted-foreground">Phone, email, address and tax ID are visible only to people who can edit the workspace. Everyone else sees the name, industry, size and website.</p>
      </CardContent></Card>

      <div className="flex items-center justify-end gap-2">
        {dirty && <Button variant="ghost" onClick={() => setF(init)}>Discard</Button>}
        <Button disabled={!dirty || busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save company</Button>
      </div>
    </div>
  );
}

export { Building2, ExternalLink, Globe, Mail, MapPin, Phone };