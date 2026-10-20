import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { MemberDetail, WorkspaceMember } from "@/types";
import { EMPLOYMENT } from "@/lib/people";
import { attempt, toInput } from "@/lib/projectMeta";
import { api } from "@/lib/api";

const initial = (d: MemberDetail) => ({
  designation: d.member.profile?.designation || "",
  department: d.member.profile?.department || "",
  employeeId: d.member.profile?.employeeId || "",
  company: d.member.profile?.company || "",
  employmentType: d.member.profile?.employmentType || "none",
  reportingManagerId: d.reportingManager?._id || "none",
  joinedAt: toInput(d.member.joinedAt),
  workLocation: d.member.profile?.workLocation || "",
  skills: (d.member.profile?.skills || []).join(", "),
  phone: d.personal?.phone || "",
  alternatePhone: d.personal?.alternatePhone || "",
  dateOfBirth: toInput(d.personal?.dateOfBirth),
  line1: d.personal?.address?.line1 || "",
  line2: d.personal?.address?.line2 || "",
  city: d.personal?.address?.city || "",
  state: d.personal?.address?.state || "",
  country: d.personal?.address?.country || "",
  postalCode: d.personal?.address?.postalCode || "",
  ecName: d.personal?.emergencyContact?.name || "",
  ecPhone: d.personal?.emergencyContact?.phone || "",
  ecRelation: d.personal?.emergencyContact?.relation || "",
});

export function EditProfileDialog({
  open, onOpenChange, workspaceId, detail, members, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  detail: MemberDetail;
  members: WorkspaceMember[];
  onSaved: () => void;
}) {
  const [f, setF] = useState(() => initial(detail));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ReturnType<typeof initial>, v: string) => setF((s) => ({ ...s, [k]: v }));
  const all = detail.permissions.canEditAllFields;

  useEffect(() => { if (open) setF(initial(detail)); }, [open, detail]);

  const save = async () => {
    const profile: Record<string, unknown> = { workLocation: f.workLocation, skills: f.skills };
    const body: Record<string, unknown> = {
      profile,
      personal: {
        phone: f.phone, alternatePhone: f.alternatePhone, dateOfBirth: f.dateOfBirth,
        address: { line1: f.line1, line2: f.line2, city: f.city, state: f.state, country: f.country, postalCode: f.postalCode },
        emergencyContact: { name: f.ecName, phone: f.ecPhone, relation: f.ecRelation },
      },
    };
    if (all) {
      Object.assign(profile, {
        designation: f.designation, department: f.department, employeeId: f.employeeId, company: f.company,
        employmentType: f.employmentType === "none" ? "" : f.employmentType,
        reportingManagerId: f.reportingManagerId === "none" ? "" : f.reportingManagerId,
      });
      if (f.joinedAt) body.joinedAt = f.joinedAt;
    }
    setBusy(true);
    const ok = await attempt(() => api.patch(`/workspaces/${workspaceId}/members/${detail.member._id}`, body), "Profile saved");
    setBusy(false);
    if (ok) { onSaved(); onOpenChange(false); }
  };

  const managers = members.filter((m) => m.userId._id !== detail.member.userId._id);

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Edit profile" onSubmit={save} busy={busy} submitLabel="Save profile" wide>
      <div className="space-y-5">
        {all && (
          <section className="space-y-3">
            <h4 className="text-sm font-medium">Work</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Designation"><Input value={f.designation} onChange={(e) => set("designation", e.target.value)} placeholder="Product Designer" /></Field>
              <Field label="Department"><Input value={f.department} onChange={(e) => set("department", e.target.value)} placeholder="Design" /></Field>
              <Field label="Company / organization"><Input value={f.company} onChange={(e) => set("company", e.target.value)} placeholder="Acme Corp" /></Field>
              <Field label="Employee ID"><Input value={f.employeeId} onChange={(e) => set("employeeId", e.target.value)} /></Field>
              <Field label="Employment type">
                <Select value={f.employmentType} onValueChange={(v) => set("employmentType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {EMPLOYMENT.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Joining date"><Input type="date" value={f.joinedAt} onChange={(e) => set("joinedAt", e.target.value)} /></Field>
              <Field label="Reports to" className="sm:col-span-2">
                <Select value={f.reportingManagerId} onValueChange={(v) => set("reportingManagerId", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nobody</SelectItem>
                    {managers.map((m) => <SelectItem key={m.userId._id} value={m.userId._id}>{m.userId.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h4 className="text-sm font-medium">About</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Work location"><Input value={f.workLocation} onChange={(e) => set("workLocation", e.target.value)} placeholder="Raipur office / Remote" /></Field>
            <Field label="Skills (comma separated)"><Input value={f.skills} onChange={(e) => set("skills", e.target.value)} placeholder="React, Figma, SQL" /></Field>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-medium">Contact <span className="text-xs font-normal text-muted-foreground">· private, only admins and this person see it</span></h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" /></Field>
            <Field label="Alternate phone"><Input value={f.alternatePhone} onChange={(e) => set("alternatePhone", e.target.value)} /></Field>
            <Field label="Date of birth"><Input type="date" value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></Field>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-medium">Address</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Address line 1" className="sm:col-span-2"><Input value={f.line1} onChange={(e) => set("line1", e.target.value)} /></Field>
            <Field label="Address line 2" className="sm:col-span-2"><Input value={f.line2} onChange={(e) => set("line2", e.target.value)} /></Field>
            <Field label="City"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="State"><Input value={f.state} onChange={(e) => set("state", e.target.value)} /></Field>
            <Field label="Country"><Input value={f.country} onChange={(e) => set("country", e.target.value)} /></Field>
            <Field label="Postal code"><Input value={f.postalCode} onChange={(e) => set("postalCode", e.target.value)} /></Field>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-medium">Emergency contact</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name"><Input value={f.ecName} onChange={(e) => set("ecName", e.target.value)} /></Field>
            <Field label="Phone"><Input value={f.ecPhone} onChange={(e) => set("ecPhone", e.target.value)} /></Field>
            <Field label="Relation"><Input value={f.ecRelation} onChange={(e) => set("ecRelation", e.target.value)} placeholder="Spouse, parent…" /></Field>
          </div>
        </section>
      </div>
    </FormDialog>
  );
}