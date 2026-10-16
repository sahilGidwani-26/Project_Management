import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { User } from "../models/User";
import { env } from "../config/env";
import {
  getGoogleCalendarAuthUrl,
  exchangeCodeForTokens,
  disconnectGoogleCalendar,
  isCalendarConnected,
} from "../utils/googleCalendar";

// Separate signing secret so a leaked `state` value can never be used as a login token.
const STATE_SECRET = `${env.JWT_SECRET}:gcal-state`;

const isObjectId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);

/**
 * Step 1: the (logged-in) frontend asks for the Google consent URL, then redirects the browser to it.
 * `state` is a short-lived signed token naming the user, so the callback can't be forged for someone else.
 */
export const getConnectUrl = catchAsync(async (req: Request, res: Response) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw ApiError.internal("Google Calendar isn't configured on the server (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  }

  const workspaceId = isObjectId(req.query.workspaceId) ? req.query.workspaceId : "";
  const state = jwt.sign({ userId: req.user!.id, workspaceId, purpose: "gcal-connect" }, STATE_SECRET, {
    expiresIn: "10m",
  } as jwt.SignOptions);

  return sendSuccess(res, 200, { url: getGoogleCalendarAuthUrl(state) }, "Connect URL");
});

/** Step 2: Google redirects the browser here after consent. No auth header exists on this request. */
export const googleCalendarCallback = catchAsync(async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;

  let decoded: { userId?: string; workspaceId?: string; purpose?: string } = {};
  try {
    if (state) decoded = jwt.verify(state, STATE_SECRET) as typeof decoded;
  } catch {
    // invalid or expired state: handled below
  }

  const settingsUrl = decoded.workspaceId ? `${env.CLIENT_URL}/app/${decoded.workspaceId}/settings` : `${env.CLIENT_URL}/app`;

  if (error || !code || decoded.purpose !== "gcal-connect" || !decoded.userId) {
    return res.redirect(`${settingsUrl}?calendar=error`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) return res.redirect(`${settingsUrl}?calendar=error`);

    await User.findByIdAndUpdate(decoded.userId, {
      googleCalendar: {
        connected: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
    });

    return res.redirect(`${settingsUrl}?calendar=connected`);
  } catch (err) {
    console.error("[google-calendar] Callback failed:", err);
    return res.redirect(`${settingsUrl}?calendar=error`);
  }
});

export const disconnectGoogleCalendarHandler = catchAsync(async (req: Request, res: Response) => {
  await disconnectGoogleCalendar(req.user!.id);
  return sendSuccess(res, 200, null, "Google Calendar disconnected");
});

export const getGoogleCalendarStatus = catchAsync(async (req: Request, res: Response) => {
  return sendSuccess(res, 200, { connected: await isCalendarConnected(req.user!.id) }, "Google Calendar status");
});