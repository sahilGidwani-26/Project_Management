import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AuthShell } from "@/components/auth/AuthShell";
import { AField, COMPANY_SIZES, FormAlert, INDUSTRIES, selectCls } from "@/components/auth/authUi";
import { cn } from "@/lib/utils";

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30) || "workspace";

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Enter a name for your workspace");
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/workspaces", { name: name.trim(), description, slug: `${slugify(name)}-${Date.now().toString(36).slice(-4)}` });
      const id = res.data.data._id;
      await api.put(`/workspaces/${id}/company`, { company: { industry, size, website: website.trim() } }).catch(() => undefined);
      toast.success("Your workspace is ready");
      navigate(`/app/${id}/dashboard`);
    } catch (err) {
      setError(apiError(err));
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={`Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : ""}! Set up your workspace`}
      subtitle="A workspace holds your team, projects and tasks, like “My Startup” or “Freelance Work”."
      footer={<>Joining an existing team? Open the invitation link from your email. <button type="button" onClick={logout} className="ml-1 font-medium text-primary hover:underline">Log out</button></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <AField id="name" label="Company or workspace name"><Input id="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My Startup" maxLength={80} /></AField>
        <div className="grid gap-4 sm:grid-cols-2">
          <AField id="industry" label="Industry (optional)"><select id="industry" className={cn(selectCls, "w-full")} value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">Choose…</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</select></AField>
          <AField id="size" label="Team size (optional)"><select id="size" className={cn(selectCls, "w-full")} value={size} onChange={(e) => setSize(e.target.value)}><option value="">Choose…</option>{COMPANY_SIZES.map((i) => <option key={i}>{i}</option>)}</select></AField>
        </div>
        <AField id="website" label="Website (optional)"><Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" /></AField>
        <AField id="description" label="What is this workspace for? (optional)"><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Product team, client projects…" maxLength={300} /></AField>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Create workspace</Button>
      </form>
    </AuthShell>
  );
}