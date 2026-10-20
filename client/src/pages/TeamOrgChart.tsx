import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { api } from "@/lib/api";
import { OrgNodeData } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { MemberAvatar, RoleBadge } from "@/components/people/peopleUi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface TreeNode { data: OrgNodeData; kids: TreeNode[]; size: number }

/** Builds the reporting tree. People without a (known) manager become top-level, and any circle is broken safely. */
function buildForest(nodes: OrgNodeData[]) {
  const byUser = new Map(nodes.map((n) => [n.userId, n]));
  const children = new Map<string, OrgNodeData[]>();
  const roots: OrgNodeData[] = [];
  for (const n of nodes) {
    if (n.managerUserId && byUser.has(n.managerUserId) && n.managerUserId !== n.userId) {
      children.set(n.managerUserId, [...(children.get(n.managerUserId) || []), n]);
    } else roots.push(n);
  }
  const seen = new Set<string>();
  const walk = (n: OrgNodeData): TreeNode => {
    seen.add(n.userId);
    const kids = (children.get(n.userId) || []).filter((k) => !seen.has(k.userId)).map(walk);
    return { data: n, kids, size: 1 + kids.reduce((a, k) => a + k.size, 0) };
  };
  const trees = roots.sort((a, b) => a.name.localeCompare(b.name)).map(walk);
  nodes.filter((n) => !seen.has(n.userId)).forEach((n) => { if (!seen.has(n.userId)) trees.push(walk(n)); }); // members of a reporting circle
  return trees;
}

function Branch({ t, collapsed, toggle, open }: { t: TreeNode; collapsed: Set<string>; toggle: (id: string) => void; open: (m: string) => void }) {
  const closed = collapsed.has(t.data.userId);
  return (
    <li className="py-1">
      <div className="flex flex-wrap items-center gap-2">
        {t.kids.length > 0 ? (
          <button type="button" onClick={() => toggle(t.data.userId)} className="flex h-5 w-5 items-center justify-center rounded border border-border text-xs hover:bg-secondary" aria-label={closed ? "Expand" : "Collapse"}>{closed ? "+" : "−"}</button>
        ) : <span className="h-5 w-5" />}
        <button type="button" onClick={() => open(t.data.memberId)} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left hover:shadow-sm">
          <MemberAvatar name={t.data.name} image={t.data.profileImage} className="h-8 w-8" />
          <span>
            <span className="block text-sm font-medium leading-tight">{t.data.name}</span>
            <span className="block text-xs text-muted-foreground">{[t.data.designation, t.data.department].filter(Boolean).join(" · ") || "—"}</span>
          </span>
          <RoleBadge role={t.data.role} />
        </button>
        {t.kids.length > 0 && <span className="text-xs text-muted-foreground">{t.size - 1} {t.size - 1 === 1 ? "person" : "people"} below</span>}
      </div>
      {t.kids.length > 0 && !closed && (
        <ul className="ml-2.5 mt-1 border-l border-border pl-5">
          {t.kids.map((k) => <Branch key={k.data.userId} t={k} collapsed={collapsed} toggle={toggle} open={open} />)}
        </ul>
      )}
    </li>
  );
}

export default function TeamOrgChart() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["org-chart", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/org-chart`)).data.data as OrgNodeData[],
    enabled: !!workspaceId,
  });

  const trees = useMemo(() => buildForest(data || []), [data]);
  const withManager = (data || []).filter((n) => n.managerUserId).length;
  const parents = useMemo(() => {
    const ids: string[] = [];
    const walk = (t: TreeNode) => { if (t.kids.length) ids.push(t.data.userId); t.kids.forEach(walk); };
    trees.forEach(walk);
    return ids;
  }, [trees]);

  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div>
      <PageHeader
        title="Org chart"
        description="Who reports to whom"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setCollapsed(new Set())}>Expand all</Button>
            <Button size="sm" variant="outline" onClick={() => setCollapsed(new Set(parents))}>Collapse all</Button>
            <Button size="sm" variant="outline" asChild><Link to={`/app/${workspaceId}/team`}>← Team</Link></Button>
          </div>
        }
      />
      <div className="space-y-4 p-6">
        {isLoading && <Skeleton className="h-64" />}
        {!isLoading && !trees.length && <EmptyState icon={Network} title="No people yet" description="Add members to see the chart." />}
        {!isLoading && !!trees.length && withManager === 0 && (
          <p className="rounded-md bg-secondary px-3 py-2 text-sm">Nobody has a manager set yet, so everyone is at the top level. Open a person's profile, choose <b>Edit profile</b>, and set <b>Reports to</b> to build the chart.</p>
        )}
        <ul>{trees.map((t) => <Branch key={t.data.userId} t={t} collapsed={collapsed} toggle={toggle} open={(m) => navigate(`/app/${workspaceId}/team/${m}`)} />)}</ul>
      </div>
    </div>
  );
}