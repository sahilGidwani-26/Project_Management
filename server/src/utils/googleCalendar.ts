import { OAuth2Client, Credentials } from "google-auth-library";
import { env } from "../config/env";
import { User } from "../models/User";

// Narrow scope, requested only when the user clicks "Connect" in Settings.
const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
const EVENTS_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function newClient(): OAuth2Client {
  return new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_CALENDAR_REDIRECT_URI);
}

export function getGoogleCalendarAuthUrl(state: string): string {
  return newClient().generateAuthUrl({
    access_type: "offline", // needed to receive a refresh_token
    prompt: "consent", // always re-issue a refresh_token, even on repeat connects
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<Credentials> {
  const { tokens } = await newClient().getToken(code);
  return tokens;
}

/** Returns a valid access token for this user, refreshing it first if it has expired. */
async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await User.findById(userId).select(
    "+googleCalendar.accessToken +googleCalendar.refreshToken +googleCalendar.expiryDate googleCalendar.connected"
  );
  if (!user?.googleCalendar?.connected || !user.googleCalendar.refreshToken) return null;

  const expiry = user.googleCalendar.expiryDate?.getTime() ?? 0;
  if (expiry - Date.now() > 60_000 && user.googleCalendar.accessToken) return user.googleCalendar.accessToken;

  const client = newClient();
  client.setCredentials({ refresh_token: user.googleCalendar.refreshToken });

  try {
    const { credentials } = await client.refreshAccessToken();
    await User.findByIdAndUpdate(userId, {
      "googleCalendar.accessToken": credentials.access_token,
      "googleCalendar.expiryDate": credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
    });
    return credentials.access_token ?? null;
  } catch (err) {
    const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
    if (code === "invalid_grant") {
      // Token was revoked or expired (Google expires them after 7 days while the app is in
      // "Testing" mode). Clear it so Settings shows "Connect" again instead of failing silently.
      await User.findByIdAndUpdate(userId, { googleCalendar: { connected: false } });
    }
    console.error("[google-calendar] Token refresh failed:", err);
    return null;
  }
}

interface EventParams {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  attendeeEmails: string[];
}

function toGoogleBody(p: EventParams) {
  return {
    summary: p.title,
    description: p.description,
    start: { dateTime: p.start.toISOString() },
    end: { dateTime: p.end.toISOString() },
    attendees: p.attendeeEmails.map((email) => ({ email })),
  };
}

/**
 * Creates an event on the organizer's own Google Calendar with an auto-generated Google Meet
 * link. Returns null if the organizer hasn't connected Google Calendar (caller falls back to Jitsi).
 * Flowbase sends its own invitation emails, so Google is told not to email guests (sendUpdates=none).
 */
export async function createGoogleMeetEvent(
  organizerId: string,
  params: EventParams
): Promise<{ meetLink: string; googleEventId: string } | null> {
  const accessToken = await getValidAccessToken(organizerId);
  if (!accessToken) return null;

  try {
    const res = await fetch(`${EVENTS_API}?conferenceDataVersion=1&sendUpdates=none`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...toGoogleBody(params),
        conferenceData: {
          createRequest: {
            requestId: `flowbase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    });

    if (!res.ok) {
      console.error("[google-calendar] Create event failed:", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as {
      id?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
    };
    const meetLink =
      data.hangoutLink || data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
    if (!meetLink || !data.id) return null;

    return { meetLink, googleEventId: data.id };
  } catch (err) {
    console.error("[google-calendar] Create event error:", err);
    return null;
  }
}

/** Keeps the Google event (and its Meet link) in sync when the Flowbase event is edited. */
export async function updateGoogleEvent(organizerId: string, googleEventId: string, params: EventParams) {
  const accessToken = await getValidAccessToken(organizerId);
  if (!accessToken) return;
  try {
    const res = await fetch(`${EVENTS_API}/${encodeURIComponent(googleEventId)}?sendUpdates=none`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(toGoogleBody(params)),
    });
    if (!res.ok) console.error("[google-calendar] Update event failed:", res.status, await res.text());
  } catch (err) {
    console.error("[google-calendar] Update event error:", err);
  }
}

export async function deleteGoogleEvent(organizerId: string, googleEventId: string) {
  const accessToken = await getValidAccessToken(organizerId);
  if (!accessToken) return;
  try {
    const res = await fetch(`${EVENTS_API}/${encodeURIComponent(googleEventId)}?sendUpdates=none`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404/410 = already gone, which is fine
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      console.error("[google-calendar] Delete event failed:", res.status);
    }
  } catch (err) {
    console.error("[google-calendar] Delete event error:", err);
  }
}

export async function isCalendarConnected(userId: string): Promise<boolean> {
  const user = await User.findById(userId).select("googleCalendar.connected");
  return !!user?.googleCalendar?.connected;
}

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  const user = await User.findById(userId).select("+googleCalendar.refreshToken");
  const refreshToken = user?.googleCalendar?.refreshToken;
  if (refreshToken) {
    try {
      // Best effort: also revoke the grant on Google's side
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      // ignore, we still clear it locally below
    }
  }
  await User.findByIdAndUpdate(userId, { googleCalendar: { connected: false } });
}