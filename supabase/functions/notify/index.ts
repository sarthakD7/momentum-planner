// Momentum Planner: notify Edge Function.
// Called every minute by pg_cron ({action:"tick"} + x-cron-secret header), and by the app
// with the signed-in user's token for {action:"vapid"} (get the push key) or {action:"test"}.
// Deploy with "Verify JWT" OFF: this function checks the cron secret / user token itself.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const URL_ = Deno.env.get("SUPABASE_URL")!;
// Server key: legacy service_role, or the newer secret key(s), whichever this project provides
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || (() => {
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return j.default || Object.values(j)[0]; } catch { return ""; }
})() as string;
const APP_URL = "https://sarthakd7.github.io/momentum-planner/";
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- config & keys ----------
type Cfg = { cron_secret: string; vapid_public: string | null; vapid_private: string | null };
let cfg: Cfg | null = null;
async function config(): Promise<Cfg> {
  if (cfg && cfg.vapid_public) return cfg;
  const { data, error } = await db.rpc("notify_config");
  if (error) throw error;
  cfg = data as Cfg;
  if (!cfg.vapid_public || !cfg.vapid_private) {
    const k = webpush.generateVAPIDKeys();
    await db.rpc("notify_set_vapid", { p_public: k.publicKey, p_private: k.privateKey });
    const again = await db.rpc("notify_config");
    cfg = again.data as Cfg;
  }
  webpush.setVapidDetails("mailto:noreply@momentum-planner.app", cfg.vapid_public!, cfg.vapid_private!);
  return cfg;
}

// ---------- time helpers (all in the user's time zone) ----------
function localNow(tz: string, at = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(at)).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const min = +p.hour * 60 + +p.minute;
  // offset (ms) between local wall clock and UTC, to turn local times back into instants
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return { date, min, dow: new Date(date + "T00:00:00Z").getUTCDay(), offset: wallAsUtc - Math.floor(at / 1000) * 1000 };
}
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const instant = (date: string, min: number, offset: number) => Date.parse(date + "T00:00:00Z") + min * 60000 - offset;
const fmt = (m: number) => { const h = Math.floor(m / 60) % 24, mm = m % 60, ap = h < 12 ? "am" : "pm", h12 = h % 12 || 12; return mm ? `${h12}:${String(mm).padStart(2, "0")}${ap}` : `${h12}${ap}`; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---------- preferences ----------
const PDEF = { on: true, tz: "Asia/Kolkata", task: true, taskLead: 5, habit: true, nudge: true, nudgeAt: 780, nudgeAt2: 1110 as number | null, wake: true, focus: true, evening: true, eveningAt: 1290, deadline: true };
type Prefs = typeof PDEF;

// ---------- what's due ----------
type Note = { key: string; title: string; body: string; tag?: string; at?: number; url?: string };

// routine wake time for a date, mirroring the app: latest wake shift step, else the wake-up block
function wakeTime(s: any, date: string, dow: number): number | null {
  const r = s && s.routine; if (!r || r.on === false) return null;
  if ((r.from && date < r.from) || (r.to && date > r.to)) return null;
  if ((s.breaks || []).some((b: any) => b.from <= date && date <= b.to)) return null;
  const step = (r.wake || []).filter((w: any) => w.from <= date).sort((a: any, b: any) => a.from.localeCompare(b.from)).pop();
  if (step && step.wake != null) return step.wake;
  const map = Array.isArray(r.map) && r.map.length === 7 ? r.map : ["sunday", "weekday", "weekday", "weekday", "weekday", "weekday", "saturday"];
  const blocks: any[] = ((r.days || {})[map[dow]] || []).slice().sort((a: any, b: any) => a.start - b.start);
  const b = blocks.find(b => /wake|morning routine|get up/i.test(b.name || "")) || blocks.find(b => b.kind === "self" && b.start < 720);
  return b ? b.start : null;
}

function dueNotes(p: Prefs, docs: Map<string, any>, nowMs: number): Note[] {
  const L = localNow(p.tz, nowMs), out: Note[] = [];
  const tasks = [...docs.entries()].filter(([k]) => k.startsWith("tasks/")).map(([k, v]) => ({ id: k.slice(6), ...v }));
  const habits = [...docs.entries()].filter(([k]) => k.startsWith("habits/")).map(([k, v]) => ({ id: k.slice(7), ...v }));
  const s = docs.get("settings/main") || {};
  const open = (t: any) => !t.done && !t.skipped;

  // 1. task starting soon
  if (p.task) for (const t of tasks) {
    if (t.date !== L.date || t.start == null || !open(t)) continue;
    const at = t.start - (p.taskLead ?? 5);
    if (L.min >= at && L.min <= t.start) out.push({ key: `task:${t.id}:${t.date}:${t.start}`, tag: "task-" + t.id,
      title: L.min >= t.start ? `Starting now: ${t.title}` : `In ${t.start - L.min} min: ${t.title}`,
      body: `${fmt(t.start)}–${fmt(t.start + (t.dur || 30))}${t.notes ? " · " + String(t.notes).slice(0, 80) : ""}` });
  }

  // 2. scheduled habits
  if (p.habit) for (const h of habits) {
    const sc = h.sched; if (h.remind === false || !sc || !Array.isArray(sc.days) || sc.start == null || !sc.days.includes(L.dow)) continue;
    if (h.days && h.days[L.date]) continue;
    const at = sc.start - (sc.before || 0) - (h.remindMin ?? 15);
    if (L.min >= at && L.min <= at + 10) out.push({ key: `habit:${h.id}:${L.date}`, tag: "habit-" + h.id,
      title: `${h.name} at ${fmt(sc.start)}`, body: sc.before ? `Leave in about ${Math.max(0, sc.start - sc.before - L.min)} min.` : `Coming up in ${Math.max(0, sc.start - L.min)} min.` });
  }

  // 2b. habit nudges: at the chosen times, the habits still unticked today (habits with their own time get their own reminder)
  if (p.nudge) for (const at of [p.nudgeAt, p.nudgeAt2]) {
    if (at == null || L.min < at || L.min > at + 15) continue;
    const due = (h: any, d: string, dow: number) => !h.sched || !Array.isArray(h.sched.days) || h.sched.days.includes(dow);
    const timed = (h: any) => h.remind !== false && h.sched && h.sched.start != null;
    const left = habits.filter(h => !h.archived && due(h, L.date, L.dow) && !(h.days && h.days[L.date]) && !timed(h) && (!h.created || h.created < nowMs));
    if (!left.length) continue;
    // current streak (days in a row ticked, counting back from yesterday, skipping days the habit isn't due)
    const streak = (h: any) => { let n = 0, d = addDays(L.date, -1);
      for (let i = 0; i < 400; i++, d = addDays(d, -1)) { const dow = new Date(d + "T00:00:00Z").getUTCDay(); if (!due(h, d, dow)) continue; if (h.days && h.days[d]) n++; else break; } return n; };
    const ranked = left.map(h => ({ h, s: streak(h) })).sort((a, b) => b.s - a.s);
    const top = ranked[0];
    out.push({ key: `habitnudge:${L.date}:${at}`, tag: "habit-nudge",
      title: left.length === 1 ? `Habit reminder: ${left[0].name}` : `${plural(left.length, "habit")} left today`,
      body: (left.length > 1 ? ranked.slice(0, 4).map(x => x.h.name).join(", ") + (left.length > 4 ? "…" : "") + ". " : "")
        + (top.s >= 2 ? `Keep your ${top.s}-day ${left.length > 1 ? top.h.name + " " : ""}streak going.` : "Tick them off to keep your momentum.") });
  }

  // 3. morning wake-up check-in
  if (p.wake && (s.wakePrompt || "auto") === "auto") {
    const w = wakeTime(s, L.date, L.dow), logged = (docs.get("notes/wakelog")?.map || {})[L.date];
    if (w != null && logged == null && L.min >= w && L.min <= w + 15) out.push({ key: `wake:${L.date}`, tag: "wake",
      title: "Good morning! When did you wake up?", body: "Tap to log it and your morning plan adjusts." });
  }

  // 4. focus session / break finished
  const f = docs.get("focus/state");
  if (p.focus && f && f.status === "running" && f.endsAt && f.endsAt <= nowMs + 60000 && f.endsAt > nowMs - 5 * 60000) {
    const task = f.taskId ? docs.get("tasks/" + f.taskId) : null;
    out.push({ key: `focus:${f.endsAt}`, tag: "focus", at: f.endsAt,
      title: f.mode === "focus" ? "Focus session done" : "Break's over",
      body: f.mode === "focus" ? `${task ? task.title + " · " : ""}Take a ${f.breakMin || 5}-minute break.` : "Ready for the next focus session?" });
  }

  // 5. evening nudge
  if (p.evening && L.min >= p.eveningAt && L.min <= p.eveningAt + 15) {
    const tm = addDays(L.date, 1), bits: string[] = [];
    const hab = habits.filter(h => !(h.days && h.days[L.date]) && (!h.sched || !Array.isArray(h.sched.days) || h.sched.days.includes(L.dow)) && (!h.created || h.created < nowMs));
    if (hab.length) bits.push(`${plural(hab.length, "habit")} not ticked (${hab.slice(0, 3).map(h => h.name).join(", ")})`);
    const part = tasks.filter(t => t.date === L.date && open(t) && (t.subtasks || []).some((x: any) => x.done));
    if (part.length) bits.push(`${plural(part.length, "task")} part-done`);
    if (!tasks.some(t => t.date === tm && open(t))) bits.push("nothing planned for tomorrow yet");
    if (bits.length) out.push({ key: `evening:${L.date}`, tag: "evening", title: "Evening check-in", body: bits.join(" · ") + "." });
  }

  // 6. deadlines 24 h ahead (from the Brief)
  if (p.deadline) for (const d of (docs.get("notes/mailfinds")?.items || [])) {
    if (d.kind !== "deadline" || d.dismissed || !d.date) continue;
    const due = instant(d.date, d.start ?? 1439, L.offset);
    if (nowMs >= due - 24 * 3600000 && nowMs < due) out.push({ key: `deadline:${d.id || d.title}:${d.date}`, tag: "deadline",
      title: `Deadline tomorrow: ${d.title}`, body: d.start != null && d.start < 1439 ? `Due ${d.date} by ${fmt(d.start)}` : `Due ${d.date}` });
  }
  return out;
}

// ---------- sending ----------
async function sendTo(owner: string, n: Note, subs: any[]) {
  let ok = 0;
  const payload = JSON.stringify({ title: n.title, body: n.body, tag: n.tag || n.key, url: n.url || APP_URL });
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 900, urgency: "high" });
      ok++;
      await db.from("push_subscriptions").update({ last_ok: new Date().toISOString() }).eq("owner", owner).eq("endpoint", s.endpoint);
    } catch (e: any) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await db.from("push_subscriptions").delete().eq("owner", owner).eq("endpoint", s.endpoint);
      else console.error("push failed", e?.statusCode, e?.body || e?.message);
    }
  }
  return ok;
}

async function loadDocs(owner: string, tz: string) {
  const L = localNow(tz), dates = [addDays(L.date, -1), L.date, addDays(L.date, 1)];
  const [a, b] = await Promise.all([
    db.from("docs").select("path,data").eq("owner", owner).in("coll", ["habits", "settings", "focus", "notes", "notify"]),
    db.from("docs").select("path,data").eq("owner", owner).eq("coll", "tasks").in("data->>date", dates),
  ]);
  if (a.error) throw a.error; if (b.error) throw b.error;
  const m = new Map<string, any>();
  for (const r of [...a.data!, ...b.data!]) if (!/^notes\/(scribble|attendance)$/.test(r.path)) m.set(r.path, r.data);
  return m;
}

async function tick() {
  await config();
  const { data: subs, error } = await db.from("push_subscriptions").select("owner,endpoint,p256dh,auth");
  if (error) throw error;
  const byOwner = new Map<string, any[]>();
  for (const s of subs!) (byOwner.get(s.owner) || byOwner.set(s.owner, []).get(s.owner)!).push(s);
  let sent = 0;
  const waits: Promise<void>[] = [];
  for (const [owner, list] of byOwner) {
    try {
      const pr = await db.from("docs").select("data").eq("owner", owner).eq("path", "notify/prefs").maybeSingle();
      const p: Prefs = { ...PDEF, ...(pr.data?.data || {}) };
      if (!p.on) continue;
      const docs = await loadDocs(owner, p.tz);
      for (const n of dueNotes(p, docs, Date.now())) {
        const fire = async () => {
          if (!(await db.rpc("notify_claim", { p_owner: owner, p_key: n.key })).data) return;
          sent += await sendTo(owner, n, list);
        };
        const wait = n.at ? n.at - Date.now() : 0;
        if (wait > 0) waits.push(new Promise(r => setTimeout(r, Math.min(wait, 58000))).then(fire)); // land focus alerts on the second
        else await fire();
      }
    } catch (e) { console.error("owner failed", owner, e); }
  }
  await Promise.all(waits);
  return { owners: byOwner.size, sent };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const c = await config();
    if (req.headers.get("x-cron-secret")) {
      if (req.headers.get("x-cron-secret") !== c.cron_secret) return json({ error: "forbidden" }, 403);
      return json(await tick());
    }
    // calls from the app: must carry the signed-in user's token
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = token ? await db.auth.getUser(token) : { data: { user: null } };
    if (!u?.user) return json({ error: "sign in first" }, 401);
    if (body.action === "vapid") return json({ publicKey: c.vapid_public });
    if (body.action === "test") {
      const { data: subs } = await db.from("push_subscriptions").select("endpoint,p256dh,auth").eq("owner", u.user.id);
      const ok = await sendTo(u.user.id, { key: "test", tag: "test", title: "Reminders are working", body: "This is how Momentum Planner will nudge you." }, subs || []);
      return json({ devices: (subs || []).length, delivered: ok });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    console.error(e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
