// Momentum Planner: gcal Edge Function — the app's bridge to Google Calendar.
// The app asks for calendar "tools" (list_events, list_calendars, create_event, update_event, delete_event)
// and this function runs them against the Google Calendar API with the user's stored access.
//
// Calls:
//   app    POST {action:"status"|"start"|"disconnect"} + user token
//   app    POST {action:"call", tool, input} + user token      → { payload } or { error: { code, message } }
//   Google GET /gcal/callback?code&state                        → finish connecting Google Calendar
// Deploy with "Verify JWT" OFF: it checks the user token itself.
//
// Secrets (shared with mailscan): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
// In Google Cloud: enable the Google Calendar API, and add this function's /callback URL to the OAuth client.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || (() => {
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return j.default || Object.values(j)[0]; } catch { return ""; }
})() as string;
const G_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const G_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const REDIRECT = SB_URL.replace(/\/$/, "") + "/functions/v1/gcal/callback";
const APP_URL = "https://sarthakd7.github.io/momentum-planner/";
const SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly openid email";
const API = "https://www.googleapis.com/calendar/v3";
const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const page = (title: string, msg: string) => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;padding:32px;max-width:520px;margin:auto"><h2>${title}</h2><p>${msg}</p><p><a href="${APP_URL}">Back to Momentum Planner</a></p></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
const fail = (code: string, message: string) => Object.assign(new Error(message), { code });

async function userFrom(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user || null;
}

// ---------- access tokens (kept for their lifetime while this instance is warm) ----------
const tokens = new Map<string, { token: string; until: number }>();
async function accessToken(owner: string): Promise<string> {
  const hit = tokens.get(owner); if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const { data: link } = await db.rpc("cal_link_get", { p_owner: owner });
  if (!link) throw fail("consent_required", "Google Calendar isn't connected.");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: G_ID, client_secret: G_SECRET, refresh_token: link.refresh_token, grant_type: "refresh_token" }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(d.error === "invalid_grant" ? "needs_reauth" : "upstream_error", "Google sign-in: " + (d.error_description || d.error || r.status));
  tokens.set(owner, { token: d.access_token, until: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}

async function g(owner: string, method: string, path: string, body?: unknown, query?: Record<string, string>) {
  const tok = await accessToken(owner);
  const u = new URL(API + path); if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== "") u.searchParams.set(k, v);
  const r = await fetch(u, { method, headers: { Authorization: "Bearer " + tok, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return {};
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { tokens.delete(owner); throw fail("needs_reauth", "Google Calendar access expired."); }
  if (r.status === 403 && /insufficient|scope/i.test(JSON.stringify(d))) throw fail("needs_reauth", "Google Calendar needs to be reconnected.");
  if (!r.ok) throw fail(r.status >= 500 || r.status === 429 ? "upstream_error" : "tool_error", d?.error?.message || "Google Calendar error " + r.status);
  return d;
}

// ---------- the calendar "tools" the app uses ----------
const cal = (i: any) => encodeURIComponent(i.calendarId || "primary");
function eventBody(i: any) {
  const b: any = {};
  if (i.summary != null) b.summary = i.summary;
  if (i.description != null) b.description = i.description;
  if (i.location != null) b.location = i.location;
  if (i.startTime) b.start = { dateTime: i.startTime, timeZone: i.timeZone || "Asia/Kolkata" };
  if (i.endTime) b.end = { dateTime: i.endTime, timeZone: i.timeZone || "Asia/Kolkata" };
  if (Array.isArray(i.recurrenceData)) b.recurrence = i.recurrenceData;
  if (Array.isArray(i.overrideReminders)) b.reminders = { useDefault: false, overrides: i.overrideReminders };
  return b;
}
async function runTool(owner: string, tool: string, i: any) {
  if (tool === "list_events") {
    const items: any[] = []; let pageToken = "";
    for (let n = 0; n < 4; n++) {   // at most 4 pages (1000 events)
      const d: any = await g(owner, "GET", `/calendars/${cal(i)}/events`, undefined, { timeMin: i.startTime, timeMax: i.endTime, singleEvents: "true",
        orderBy: "startTime", maxResults: String(Math.min(250, i.pageSize || 250)), pageToken });
      items.push(...(d.items || [])); pageToken = d.nextPageToken || ""; if (!pageToken) break;
    }
    return { events: items };
  }
  if (tool === "list_calendars") {
    const d: any = await g(owner, "GET", "/users/me/calendarList", undefined, { maxResults: "250" });
    return { calendars: (d.items || []).map((c: any) => ({ id: c.id, summary: c.summaryOverride || c.summary, primary: !!c.primary, accessRole: c.accessRole, backgroundColor: c.backgroundColor })) };
  }
  if (tool === "create_event") return await g(owner, "POST", `/calendars/${cal(i)}/events`, eventBody(i), { sendUpdates: "none" });
  if (tool === "update_event") {
    if (!i.eventId) throw fail("tool_error", "eventId missing");
    return await g(owner, "PATCH", `/calendars/${cal(i)}/events/${encodeURIComponent(i.eventId)}`, eventBody(i), { sendUpdates: "none" });
  }
  if (tool === "delete_event") {
    if (!i.eventId) throw fail("tool_error", "eventId missing");
    try { return await g(owner, "DELETE", `/calendars/${cal(i)}/events/${encodeURIComponent(i.eventId)}`, undefined, { sendUpdates: "none" }); }
    catch (e: any) { if (/not found|deleted|404|410/i.test(String(e.message))) return { deleted: true }; throw e; }   // already gone is fine
  }
  throw fail("tool_error", "unknown tool " + tool);
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  try {
    // Google sends the user back here after they allow access
    if (req.method === "GET" && url.pathname.endsWith("/callback")) {
      if (url.searchParams.get("error")) return page("Calendar not connected", "Access wasn't granted. You can try again from Settings → Calendar.");
      const { data: owner } = await db.rpc("mail_state_take", { p_state: url.searchParams.get("state") || "" });
      if (!owner) return page("Link expired", "That sign-in link expired. Start again from Settings → Calendar.");
      const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: url.searchParams.get("code") || "", client_id: G_ID, client_secret: G_SECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }) });
      const t = await r.json();
      if (!r.ok || !t.refresh_token) return page("Calendar not connected", "Google didn't return lasting access" + (t.error ? ` (${t.error})` : "") + ". Try again from Settings → Calendar.");
      if (!/calendar\.events/.test(t.scope || "")) return page("Calendar not connected", "Calendar access wasn't ticked on Google's screen. Try again and tick “See, edit, share and delete… events”.");
      let email = "";
      try { email = JSON.parse(atob(String(t.id_token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || ""; } catch {}
      await db.rpc("cal_link_save", { p_owner: owner, p_email: email, p_refresh: t.refresh_token });
      tokens.set(owner as string, { token: t.access_token, until: Date.now() + (t.expires_in || 3600) * 1000 });
      return Response.redirect(APP_URL + "#cal-connected", 302);
    }

    const body = await req.json().catch(() => ({}));
    const user = await userFrom(req);
    if (!user) return json({ error: "sign in first" }, 401);
    const ready = !!(G_ID && G_SECRET);

    if (body.action === "status") {
      const { data } = await db.rpc("cal_link_get", { p_owner: user.id });
      return json({ ready, connected: !!data, email: data?.email || "", connected_at: data?.connected_at || null, redirect: REDIRECT });
    }
    if (body.action === "start") {
      if (!ready) return json({ error: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Supabase secrets first." }, 400);
      const { data: state } = await db.rpc("mail_state_create", { p_owner: user.id });
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.search = new URLSearchParams({ client_id: G_ID, redirect_uri: REDIRECT, response_type: "code", access_type: "offline", prompt: "consent",
        scope: SCOPES, state, include_granted_scopes: "true", ...(body.hint ? { login_hint: String(body.hint) } : {}) }).toString();
      return json({ url: u.toString() });
    }
    if (body.action === "disconnect") {
      const { data: refresh } = await db.rpc("cal_link_delete", { p_owner: user.id });
      tokens.delete(user.id);
      // Gmail scan shares the same Google grant: only revoke when nothing else uses it
      const { data: other } = await db.rpc("google_links", { p_owner: user.id });
      if (refresh && !other?.mail) await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(refresh), { method: "POST" }).catch(() => {});
      return json({ ok: true });
    }
    if (body.action === "call") {
      try { return json({ payload: await runTool(user.id, String(body.tool || ""), body.input || {}) }); }
      catch (e: any) { return json({ error: { code: e.code || "upstream_error", message: String(e.message || e) } }, 200); }
    }
    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    console.error(e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
