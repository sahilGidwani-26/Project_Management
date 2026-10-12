import { Server as SocketIOServer } from "socket.io";
import { Project } from "../models/Project";
import { User } from "../models/User";
import { Notification } from "../models/Notification";
import { ForecastSnapshot } from "../models/ForecastSnapshot";
import { sendMail } from "../utils/mailer";
import { projectLeads } from "../services/projectEvents";
import { DAY, computeForecast, saveSnapshot, utcKey } from "../services/forecast";
import { buildProjectUrl, forecastEmail } from "../utils/projectEmailTemplates";

const EVERY = 6 * 60 * 60 * 1000;
const OPEN = ["Planning", "Active", "On Hold"];

export function startForecastJob(io: SocketIOServer) {
  const run = async () => {
    try {
      const projects = await Project.find({ status: { $in: OPEN } }).limit(2000);
      for (const p of projects) {
        try {
          await processProject(p, io);
        } catch (e) {
          console.error(`[forecast] skipped project ${p._id}:`, (e as Error).message); // one bad project never stops the batch
        }
      }
    } catch (e) {
      console.error("[forecast] job failed:", e);
    }
  };
  setTimeout(run, 90_000); // shortly after boot
  setInterval(run, EVERY);
}

async function processProject(p: any, io: SocketIOServer) {
  const now = Date.now();
  if (await ForecastSnapshot.exists({ projectId: p._id, day: utcKey(now) })) return;

  const f = await computeForecast(p, {});

  let alerted = false;
  if (f.state === "AT_RISK" && f.deadline) {
    const recent = await ForecastSnapshot.exists({ projectId: p._id, alerted: true, day: { $gte: utcKey(now - 7 * DAY) } });
    if (!recent) {
      await alertLeads(p, f, io);
      alerted = true;
    }
  }
  await saveSnapshot(p, f, alerted, now);
}

async function alertLeads(p: any, f: any, io: SocketIOServer) {
  const users: any[] = await User.find({ _id: { $in: projectLeads(p) } }).select("email name notificationPreferences");
  const url = buildProjectUrl(String(p.workspaceId), String(p._id), "forecast");

  for (const u of users) {
    await Notification.create({
      userId: u._id,
      type: "forecast_risk" as any,
      title: "Deadline at risk",
      message: `"${p.name}" has only a ${f.probability}% chance to meet its deadline`,
      relatedWorkspaceId: p.workspaceId,
      relatedProjectId: p._id,
    });
    io.to(`user:${u._id}`).emit("notification:new", { title: "Deadline at risk" });

    if (u.notificationPreferences?.deadlines !== false && u.email) {
      const { subject, html } = forecastEmail({
        projectName: p.name,
        deadline: f.deadline,
        p85: f.dates.p85,
        probability: f.probability,
        remaining: f.openTasks,
        removeNeeded: f.fix?.removeNeeded,
        url,
      });
      sendMail(u.email, subject, html).catch(() => {});
    }
  }
}