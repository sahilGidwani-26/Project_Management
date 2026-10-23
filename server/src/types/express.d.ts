import type { AccessCtx } from "../services/permissions";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
      workspaceRole?: string;
      access?: AccessCtx;
    }
  }
}
export {};