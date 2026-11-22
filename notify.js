// Momentum Planner: Reminders + Account settings (renders into the Settings → Reminders pane).
// init(supabase|null, db|null) is called by boot.js; render(el) by the Settings sheet.

const PDEF = { on: true, tz: "", task: true, taskLead: 5, habit: true, nudge: true, nudgeAt: 780, nudgeAt2: 1110, wake: true, focus: true, evening: true, eveningAt: 1290, deadline: true };
let SB = null, DB = null;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const b64ToBytes = s => { const p = "=".repeat((4 - (s.length % 4)) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const bytesToB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const grp = (title, desc, body) => `<div class="sgroup"><div class="sgh"><b>${title}</b>${desc ? `<span>${desc}</span>` : ""}</div>${body}</div>`;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function prefs() {
  let p = {};
  try { const s = await DB.doc("notify/prefs").get(); if (s.exists) p = s.data(); } catch {}
  return { ...PDEF, ...p, tz: p.tz || Intl.DateTimeFormat().resolvedOptions().timeZone };
}
async function savePrefs(patch) { const p = { ...(await prefs()), ...patch }; await DB.doc("notify/prefs").set(p); return p; }

async function subscription() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function call(action) {
  const { data, error } = await SB.functions.invoke("notify", { body: { action } });
  if (error) { let msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return data;
}

async function enable() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." : "Notifications weren't allowed.");
  const { publicKey } = await call("vapid");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = b64ToBytes(publicKey);
  if (sub && sub.options && sub.options.applicationServerKey && bytesToB64(sub.options.applicationServerKey) !== publicKey) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const j = sub.toJSON();
  const { data: { user } } = await SB.auth.getUser();
  const { error } = await SB.from("push_subscriptions").upsert(
    { owner: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceName() },
    { onConflict: "owner,endpoint" });
  if (error) throw error;
  await savePrefs({ on: true, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
}

async function disable() {
  const sub = await subscription();
  if (sub) {
    await SB.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : /iPhone|iPad/i.test(ua) ? "iOS" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

async function render(el) {
  if (!el) return;
  if (!SB || !DB) {
    el.innerHTML = grp("Reminders", "", `<p class="note" style="margin:0">Sign in to sync to turn on reminders. Reload the page and use the email sign-in.</p>`);
    return;
  }
  el.innerHTML = `<p class="note" style="margin:0">Loading…</p>`;
  const [p, sub, { data: { user } }] = await Promise.all([prefs(), subscription().catch(() => null), SB.auth.getUser()]);
  const perm = supported() ? Notification.permission : "unsupported";
  const status = !supported() ? "This browser can't show reminders." : perm === "denied" ? "Blocked in this browser's site settings." : sub ? "On for this device." : "Off for this device.";
  const ck = (id, k, label, small) => `<label class="check"><input type="checkbox" data-np="${k}"${p[k] ? " checked" : ""}><span>${label}${small ? `<small>${small}</small>` : ""}</span></label>`;

  el.innerHTML =
    grp("Reminders on this device", "Sent even when the planner is closed. Turn them on separately on your phone and laptop.",
      `<div class="note" id="mpnStatus" style="font-weight:600">${esc(status)}</div>
       <div class="chiprow">${sub
        ? `<button type="button" class="btn" data-mpn="test">Send a test</button><button type="button" class="btn" data-mpn="off">Turn off here</button>`
        : supported() && perm !== "denied" ? `<button type="button" class="btn primary" data-mpn="on" style="flex:none">Turn on reminders</button>` : ""}</div>`) +
    grp("What to remind me about", "Applies on all your devices. Changes save right away.",
      `${ck("t", "task", "Tasks starting", "For tasks with a time on the timeline.")}
       <label class="field">How early<select data-np="taskLead">${[0, 5, 10, 15, 30].map(m => `<option value="${m}"${p.taskLead === m ? " selected" : ""}>${m ? m + " min before" : "At start time"}</option>`).join("")}</select></label>
       ${ck("h", "habit", "Habits with a set time", "Before each one starts, using the habit's own reminder time.")}
       ${ck("n", "nudge", "Habit nudges", "At these times, a reminder of the habits you haven't ticked yet today, with your streak.")}
       <div class="row2" style="display:flex;gap:8px"><label class="field" style="flex:1">First nudge<input type="time" data-np="nudgeAt" value="${p.nudgeAt != null ? hhmm(p.nudgeAt) : ""}"></label>
       <label class="field" style="flex:1">Second nudge<input type="time" data-np="nudgeAt2" value="${p.nudgeAt2 != null ? hhmm(p.nudgeAt2) : ""}"></label></div>
       <div class="note" style="margin-top:-4px">Clear a time to skip that nudge.</div>
       ${ck("w", "wake", "Morning “When did you wake up?”", "At your routine's wake-up time, if you haven't logged it yet.")}
       ${ck("f", "focus", "Focus session and break ended", "Arrives even with your phone locked.")}
       ${ck("e", "evening", "Evening check-in", "Unticked habits, part-done tasks and an empty tomorrow.")}
       <label class="field">Evening check-in time<input type="time" data-np="eveningAt" value="${hhmm(p.eveningAt)}"></label>
       ${ck("d", "deadline", "Deadlines 24 hours ahead", "From the Brief.")}
       <div class="note">Time zone: ${esc(p.tz)}</div>`) +
    grp("Account", "", `<div class="note">Signed in as <b>${esc(user?.email || "")}</b>. Your planner syncs to every device signed in with this email.</div>
       <div class="note">App version ${esc(window.mpVersion || "?")} · display ${esc(matchMedia("(display-mode: standalone)").matches ? "installed app" : "browser tab")} · bar colour ${esc(document.querySelector('meta[name="theme-color"]')?.content || "")}</div>
       <label class="field">New password<input type="password" id="mpnPw" autocomplete="new-password" minlength="8" placeholder="8+ characters"></label>
       <div class="chiprow"><button type="button" class="btn" data-mpn="pw">Set password</button><button type="button" class="btn danger" data-mpn="signout">Sign out on this device</button></div>
       <div class="note" id="mpnPwMsg">Set a password here, then sign in on your other devices with your email and this password. No email needed.</div>`);

  const say = (t, bad) => { const s = el.querySelector("#mpnStatus"); if (s) { s.textContent = t; s.style.color = bad ? "var(--warn)" : ""; } };
  el.onclick = async e => {
    const b = e.target.closest("[data-mpn]"); if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.mpn === "on") { say("Turning on…"); await enable(); await render(el); say("On for this device. Try “Send a test”."); }
      else if (b.dataset.mpn === "off") { await disable(); await render(el); }
      else if (b.dataset.mpn === "test") { say("Sending…"); const r = await call("test"); say(r.delivered ? `Sent to ${r.delivered} device${r.delivered === 1 ? "" : "s"}. It should appear in a few seconds.` : "Couldn't reach this device. Turn reminders off and on again.", !r.delivered); }
      else if (b.dataset.mpn === "pw") {
        const f = el.querySelector("#mpnPw"), m = el.querySelector("#mpnPwMsg");
        if (f.value.length < 8) { m.textContent = "Use at least 8 characters."; m.style.color = "var(--warn)"; f.focus(); return; }
        const { error } = await SB.auth.updateUser({ password: f.value });
        f.value = "";
        m.style.color = error ? "var(--warn)" : "var(--good)";
        m.textContent = error ? error.message : "Password set. Sign in on your other devices with your email and this password.";
      }
      else if (b.dataset.mpn === "signout") {
        if (DB.pending && DB.pending() && !confirm("Some changes haven't synced yet and will be lost. Sign out anyway?")) return;
        await disable().catch(() => {});
        await SB.auth.signOut();
        ["mp.cache.v1", "mp.queue.v1"].forEach(k => { try { localStorage.removeItem(k); } catch {} });
        location.reload();
      }
    } catch (err) { say(err.message || String(err), true); }
    finally { b.disabled = false; }
  };
  el.onchange = async e => {
    const i = e.target.closest("[data-np]"); if (!i) return;
    const k = i.dataset.np;
    const v = i.type === "checkbox" ? i.checked : i.type === "time" ? (i.value ? (([h, m]) => +h * 60 + +m)(i.value.split(":")) : null) : +i.value;
    if (k === "eveningAt" && !Number.isFinite(v)) return;
    if (i.type === "time" && v != null && !Number.isFinite(v)) return;
    try { await savePrefs({ [k]: v }); } catch (err) { say("Couldn't save: " + (err.message || err), true); }
  };
}

export function init(supabase, db) { SB = supabase; DB = db; }
window.mpNotify = { render };
