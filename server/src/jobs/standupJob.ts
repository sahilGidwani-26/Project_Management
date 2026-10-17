import { User } from "../models/User";
import { WorkspaceMember } from "../models/WorkspaceMember";
import { StandupDigest } from "../models/Standup";
import { localParts, safeTz, sendDigest } from "../services/standup";

const EVERY = 60 * 60 * 1000;

export function startStandupJob() {
  setTimeout(run, 120_000); // shortly after boot
  setInterval(run, EVERY);
}

async function run() {
  try {
    const users: any[] = await User.find({ accountStatus: "active", "notificationPreferences.standupDigest": true })
      .select("name email timezone notificationPreferences")
      .limit(5000);
    for (const u of users) {
      try {
        await digestFor(u);
      } catch (e) {
        console.error(`[standup] skipped user ${u._id}:`, (e as Error).message); // one bad user never stops the rest
      }
    }
  } catch (e) {
    console.error("[standup] job failed:", e);
  }
}

async function digestFor(u: any) {
  const { day, weekday, hour } = localParts(Date.now(), safeTz(u.timezone));
  if (weekday === "Sat" || weekday === "Sun") return;

  // send during the 6 hours that start at the chosen hour (so a server restart does not skip the day)
  const target = u.notificationPreferences?.standupHour ?? 9;
  if (hour < target || hour > target + 5) return;

  const memberships: any[] = await WorkspaceMember.find({ userId: u._id, status: "active" }).select("workspaceId");
  for (const m of memberships) {
    try {
      await StandupDigest.create({ userId: u._id, workspaceId: m.workspaceId, day }); // claims today's slot
    } catch (e: any) {
      if (e?.code === 11000) continue; // already handled today
      throw e;
    }
    await sendDigest(u, String(m.workspaceId));
  }
}