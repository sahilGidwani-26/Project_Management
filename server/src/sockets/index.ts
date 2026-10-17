import { Server as HTTPServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { verifyToken } from "../utils/token";
import { env } from "../config/env";
import { Project } from "../models/Project";
import { PokerSession } from "../models/Poker";
import { resolveProjectRole } from "../utils/projectAccess";

interface AuthedSocket extends Socket {
  userId?: string;
}

/**
 * Real-time layer for:
 *  1) Project/Kanban updates  -> rooms: `project:<projectId>`
 *  2) Team chat (Slack-style) -> rooms: `channel:<channelId>`
 *  3) Personal notifications  -> rooms: `user:<userId>`
 *  4) Planning poker          -> rooms: `poker:<sessionId>` (join is permission-checked)
 */
export function initSocket(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      credentials: true,
    },
  });

  io.use((socket: AuthedSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers.cookie
          ?.split("; ")
          .find((c) => c.startsWith(`${env.JWT_COOKIE_NAME}=`))
          ?.split("=")[1];

      if (!token) return next(new Error("Authentication required"));

      const payload = verifyToken(token);
      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket: AuthedSocket) => {
    if (socket.userId) socket.join(`user:${socket.userId}`);

    // ---- Project / Kanban rooms ----
       // ---- Project / Kanban rooms (only people who can open the project may join) ----
    socket.on("project:join", async (projectId: string) => {
      try {
        if (!socket.userId || !/^[a-f\d]{24}$/i.test(String(projectId))) return;
        const project = await Project.findById(projectId);
        if (!project || !(await resolveProjectRole(project, socket.userId))) return;
        socket.join(`project:${projectId}`);
      } catch {
        /* ignore, the page still works through normal refetching */
      }
    });
    socket.on("project:leave", (projectId: string) => {
      socket.leave(`project:${projectId}`);
    });

    // ---- Planning poker rooms (only people who can open the project may join) ----
    socket.on("poker:join", async (sessionId: string, ack?: (r: { ok: boolean }) => void) => {
      const done = (ok: boolean) => typeof ack === "function" && ack({ ok });
      try {
        if (!socket.userId || !/^[a-f\d]{24}$/i.test(String(sessionId))) return done(false);
        const session: any = await PokerSession.findById(sessionId).select("projectId").lean();
        if (!session) return done(false);
        const project = await Project.findById(session.projectId);
        if (!project || !(await resolveProjectRole(project, socket.userId))) return done(false);
        socket.join(`poker:${sessionId}`);
        done(true);
      } catch {
        done(false);
      }
    });
    socket.on("poker:leave", (sessionId: string) => {
      socket.leave(`poker:${sessionId}`);
    });

    // ---- Chat channel rooms ----
    socket.on("channel:join", (channelId: string) => {
      socket.join(`channel:${channelId}`);
    });
    socket.on("channel:leave", (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    // Typing indicators, Slack-style.
    socket.on("channel:typing", ({ channelId, userName }: { channelId: string; userName: string }) => {
      socket.to(`channel:${channelId}`).emit("channel:typing", { userId: socket.userId, userName });
    });
    socket.on("channel:stop-typing", ({ channelId }: { channelId: string }) => {
      socket.to(`channel:${channelId}`).emit("channel:stop-typing", { userId: socket.userId });
    });

    socket.on("disconnect", () => {
      // Presence cleanup hook (e.g. broadcast "user offline") can go here.
    });
  });

  return io;
}