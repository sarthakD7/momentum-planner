// Momentum Planner: Google Calendar bridge.
// The app was written against claude.ai's connector interface (window.claude.use("mcp") / ("permissions")).
// This module provides the same interface, backed by the gcal Edge Function, so the app's calendar code
// (events on the timeline and in the Brief, sending tasks and habits) works unchanged.
// Settings → Calendar gets a connection section from render().

const SERVER = "Google Calendar";
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
let status = null, statusAt = 0;
const sb = () => window.mpSupabase;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function fn(action, extra = {}) {
  const { data, error } = await sb().functions.invoke("gcal", { body: { action, ...extra } });
  if (error) { let msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch {} throw Object.assign(new Error(msg), { code: "upstream_error" }); }
  return data;
}
async function getStatus(force) {
  if (!status || force || Date.now() - statusAt > 5 * 60_000) {
    try { status = await fn("status"); } catch { status = status || { ready: false, connected: false, offline: true }; }
    statusAt = Date.now();
  }
  return status;
}
async function connect() {
  const s = await getStatus(true);
  if (!s.ready) { alert("Google sign-in isn't set up on the server yet (Settings → Calendar shows what's missing)."); return; }
  const { data: { user } } = await sb().auth.getUser();
  const r = await fn("start", { hint: user?.email || "" });
  if (r && r.url) location.assign(r.url);
}

// local "2026-11-23T00:00:00" → an exact instant, in this device's time zone
const instant = s => (!s || /Z|[+-]\d\d:\d\d$/.test(s)) ? s : new Date(s).toISOString();

async function callTool(server, tool, input = {}) {
  const i = { ...input };
  if (tool === "list_events") { i.startTime = instant(i.startTime); i.endTime = instant(i.endTime); }
  if (tool === "create_event" || tool === "update_event") i.timeZone = TZ;
  let r;
  try { r = await fn("call", { tool, input: i }); }
  catch (e) { throw { code: e.code || "upstream_error", message: e.message }; }
  if (r && r.error) {
    if (r.error.code === "consent_required" || r.error.code === "needs_reauth") { status = null; }
    throw { code: r.error.code, message: r.error.message };
  }
  return { payload: r ? r.payload : null };
}

// watchTool: fetch now, then again every refetchInterval while the page is visible, and when it comes back into view
const watchers = new Set();
function watchTool(server, tool, input, handler, opts = {}) {
  const w = { tool, last: 0, dead: false,
    run: async () => { w.last = Date.now();
      try { const r = await callTool(server, tool, input); if (!w.dead) handler({ type: "data", result: r }); }
      catch (e) { if (!w.dead) handler({ type: "error", error: e }); } } };
  w.every = opts.refetchInterval || 120_000;
  w.timer = setInterval(() => { if (document.visibilityState === "visible") w.run(); }, w.every);
  watchers.add(w); w.run();
  return () => { w.dead = true; clearInterval(w.timer); watchers.delete(w); };
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  watchers.forEach(w => { if (Date.now() - w.last > 60_000) w.run(); });
});
async function invalidate(server, tool) { watchers.forEach(w => { if (!tool || w.tool === tool) w.run(); }); }

export const mcp = { callTool, watchTool, invalidate };
export const perms = {
  async state(key) { const s = await getStatus(); return s.connected ? "granted" : s.ready || s.offline ? "prompt" : "unavailable"; },
  manage: connect,
  connect,
};

// ---------- Settings → Calendar: connection section ----------
async function render(el) {
  if (!el) return;
  if (!sb()) { el.innerHTML = `<div class="sgroup"><div class="sgh"><b>Google Calendar</b></div><p class="note" style="margin:0">Sign in to sync to connect Google Calendar.</p></div>`; return; }
  el.innerHTML = `<p class="note" style="margin:0">Checking Google Calendar…</p>`;
  const s = await getStatus(true);
  const body = !s.ready
    ? `<p class="note" style="margin:0">Google sign-in isn't set up on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Supabase → Edge Functions → Secrets, then come back.</p>`
    : s.connected
      ? `<div class="note">Connected${s.email ? ` as <b>${esc(s.email)}</b>` : ""}. Events from the calendars ticked below show on your timeline and in the Brief, on every device you're signed in on.</div>
         <div class="chiprow"><button type="button" class="btn" data-gc="refresh">Refresh now</button><button type="button" class="btn danger" data-gc="off">Disconnect</button></div>`
      : `<div class="note">See your Google Calendar events (and an Outlook calendar subscribed in Google) on the timeline and in the Brief, and optionally send time-boxed tasks to your calendar.</div>
         <div class="chiprow"><button type="button" class="btn primary" data-gc="on" style="flex:none">Connect Google Calendar</button></div>
         <div class="note" style="font-size:12px">Google will ask to let Momentum Planner see and edit calendar events. Nothing is added to your calendar unless you turn on sending below or per task.</div>`;
  el.innerHTML = `<div class="sgroup"><div class="sgh"><b>Google Calendar</b></div>${body}<div class="note" id="gcMsg" style="margin:0"></div></div>`;
  el.onclick = async e => {
    const b = e.target.closest("[data-gc]"); if (!b) return;
    const msg = el.querySelector("#gcMsg"); b.disabled = true;
    try {
      if (b.dataset.gc === "on") { msg.textContent = "Opening Google…"; await connect(); }
      else if (b.dataset.gc === "refresh") { await invalidate(SERVER); msg.textContent = "Refreshing…"; setTimeout(() => { msg.textContent = ""; }, 2500); }
      else if (b.dataset.gc === "off") {
        if (!confirm("Disconnect Google Calendar? Events stop showing here. Events already sent to your calendar stay there.")) return;
        await fn("disconnect"); status = null; location.reload();
      }
    } catch (err) { msg.textContent = err.message || String(err); msg.style.color = "var(--warn)"; }
    finally { b.disabled = false; }
  };
}
window.mpCal = { render, connect };

// back from Google
if (location.hash === "#cal-connected") {
  history.replaceState(null, "", location.pathname + location.search);
  setTimeout(() => { const t = document.createElement("div"); t.textContent = "Google Calendar connected"; t.style.cssText = "position:fixed;left:50%;top:20px;transform:translateX(-50%);z-index:200;background:#1f8a57;color:#fff;padding:10px 16px;border-radius:12px;font:600 14px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.3)"; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); }, 1500);
}
