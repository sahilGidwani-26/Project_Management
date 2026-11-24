import { AsyncLocalStorage } from "async_hooks";
import { NextFunction, Request, Response } from "express";

export const mailCtx = new AsyncLocalStorage<{ workspaceId?: string }>();

/** Every request gets its own small store. */
export const mailContextMiddleware = (_req: Request, _res: Response, next: NextFunction) => mailCtx.run({}, next);

/** Called as soon as a request is known to belong to a workspace: emails sent while handling it use that workspace's mail account. */
export const setMailWorkspace = (workspaceId: unknown) => {
  const s = mailCtx.getStore();
  if (s && workspaceId) s.workspaceId = String(workspaceId);
};