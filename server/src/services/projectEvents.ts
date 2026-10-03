import { Types } from "mongoose";
import { ActivityLog } from "../models/ActivityLog";
import { User } from "../models/User";
import { IProject } from "../models/Project";
// ASSUMPTION: sendMail jahan hai wahan ka path set karo.
import { sendMail } from "../utils/mailer";

type Id = Types.ObjectId | string | undefined | null;

/** Kabhi throw nahi karta: activity log fail ho to bhi request nahi tootti. */
export async function logActivity(p: {
  workspaceId: Id;
  projectId: Id;
  actorId: Id;
  action: string;
  entity?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await ActivityLog.create({
      workspaceId: p.workspaceId,
      actorId: p.actorId,
      action: p.action,
      resourceType: "Project",
      resourceId: p.projectId,
      metadata: { entity: p.entity, ...p.metadata },
    });
  } catch (e) {
    console.warn("[activity] skipped:", (e as Error).message);
  }
}

export async function getName(id: Id) {
  const u: any = await User.findById(id).select("name");
  return (u?.name as string) || "Someone";
}

export const uniqueIds = (ids: Id[]) => [...new Set(ids.filter(Boolean).map(String))];

export const projectRecipients = (p: IProject) => uniqueIds([p.managerId, p.createdBy, ...p.members]);
export const projectLeads = (p: IProject) =>
  uniqueIds([p.managerId, p.createdBy, ...p.memberRoles.filter((m) => m.role === "ADMIN").map((m) => m.userId)]);

/** Fire-and-forget email (actor ko skip karta hai). Use: `void sendToUsers(...)` */
export function sendToUsers(userIds: Id[], actorId: Id, build: (u: { name: string; email: string }) => { subject: string; html: string }): Promise<void> {
  return (async () => {
    const ids = uniqueIds(userIds).filter((id) => id !== String(actorId));
    if (!ids.length) return;
    const users: any[] = await User.find({ _id: { $in: ids } }).select("name email");
    await Promise.allSettled(
      users
        .filter((u) => u.email)
        .map((u) => {
          const { subject, html } = build({ name: u.name, email: u.email });
          return sendMail(u.email, subject, html);
        })
    );
  })().catch((e) => console.warn("[mail] project notification failed:", (e as Error).message));
}