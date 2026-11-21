// Momentum Planner: look & feel extras
//  1. Panel transparency for the Frosted glass style (Settings → Appearance), synced across devices (doc ui/look)
//  2. Account badge at the top left of the Dashboard, opening a small account pill
//  3. "Expanding pill" animation: search, momentum, level and account open by growing out of their button

const LS = "mp.look.v1";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- 1. transparency ---------- */
const DEF = { clarity: 50 };   // 0 = most solid, 100 = most see-through; 50 = the original look
let look = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(LS) || "{}") }; } catch { return { ...DEF }; } })();
let db = null;

const css = document.createElement("style");
css.id = "look-css";
css.textContent = `
/* panel opacity for Frosted glass: --ui-op scales the theme's own alpha values (1 = original) */
:root:root[data-style="glass"]{--surface:rgba(255,255,255,calc(.56*var(--ui-op,1)));--surface-2:rgba(255,255,255,calc(.36*var(--ui-op,1)));--g-card:rgba(255,255,255,calc(.42*var(--ui-op,1)))}
@media (prefers-color-scheme: dark){:root:root[data-style="glass"]:not([data-theme="light"]){--surface:rgba(22,28,44,calc(.52*var(--ui-op,1)));--surface-2:rgba(255,255,255,calc(.055*var(--ui-op,1)));--g-card:rgba(255,255,255,calc(.045*var(--ui-op,1)))}}
:root:root[data-style="glass"][data-theme="dark"]{--surface:rgba(22,28,44,calc(.52*var(--ui-op,1)));--surface-2:rgba(255,255,255,calc(.055*var(--ui-op,1)));--g-card:rgba(255,255,255,calc(.045*var(--ui-op,1)))}

/* account badge (Dashboard only) */
.acct{flex:none;width:34px;height:34px;border-radius:50%;padding:0;display:grid;place-items:center;cursor:pointer;position:relative;
  border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);
  background:color-mix(in srgb,var(--accent) 16%,transparent);-webkit-backdrop-filter:blur(12px) saturate(1.4);backdrop-filter:blur(12px) saturate(1.4);
  color:var(--accent);font:800 14px var(--f-display);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 14%,transparent)}
.acct i{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;border:2px solid var(--bg);background:var(--muted)}
.acct i.ok{background:var(--good)} .acct i.warn{background:var(--warn)}
body:not([data-view="stats"]) .acct{display:none}
.acctpop{display:flex;flex-direction:column;gap:12px}
.acctpop .who{display:flex;align-items:center;gap:12px}
.acctpop .who .acct{width:44px;height:44px;font-size:18px;cursor:default}
.acctpop .who b{display:block;font-size:15px;overflow-wrap:anywhere}
.acctpop .who span{font-size:12px;color:var(--muted)}
.acctpop .row{display:flex;gap:8px;flex-wrap:wrap}
.acctpop .row .btn{flex:1}

/* expanding pill: the sheet grows out of the button that opened it */
.scrim.pillpop{align-items:flex-start!important;justify-content:center;padding:calc(env(safe-area-inset-top,0px) + 56px) 8px 8px;background:rgba(8,12,18,.28)}
.scrim.pillpop>.sheet,.scrim.pillpop>form.sheet{width:min(400px,100%);max-height:min(78vh,640px);border-radius:28px!important;margin:0!important;align-self:flex-start!important;box-shadow:0 20px 60px -12px rgba(0,0,0,.55)}
@media (min-width:700px){.scrim.pillpop{justify-content:flex-end;padding-right:16px}}
@media (max-width:760px){.bnav{touch-action:none}}
`;
document.head.appendChild(css);
// keep these rules after the app's own styles (which live in <body>) so they win
const keepLast = () => { if (document.body && document.body.lastElementChild !== css) document.body.appendChild(css); };
if (document.body) keepLast(); else document.addEventListener("DOMContentLoaded", keepLast);

function apply() {
  const t = Math.max(0, Math.min(100, +look.clarity || 0));
  const op = 1.8 - 1.6 * (t / 100);     // 0 → 1.8× (solid), 50 → 1× (original), 100 → 0.2× (very clear)
  document.documentElement.style.setProperty("--ui-op", op.toFixed(3));
}
apply();

let saveT = 0;
function setLook(patch) {
  look = { ...look, ...patch };
  try { localStorage.setItem(LS, JSON.stringify(look)); } catch {}
  apply();
  clearTimeout(saveT);
  saveT = setTimeout(() => { if (db) db.doc("ui/look").set({ ...look, at: Date.now() }).catch(() => {}); }, 500);
}

(async () => {
  try {
    db = window.claude && (await window.claude.use("db"));
    if (!db) return;
    db.doc("ui/look").onSnapshot(s => {
      if (!s.exists) return;
      const d = s.data(); if (d && d.clarity != null && d.clarity !== look.clarity) { look = { ...look, clarity: d.clarity }; try { localStorage.setItem(LS, JSON.stringify(look)); } catch {} apply(); }
    }, () => {});
  } catch {}
})();

function renderLook(el) {
  if (!el) return;
  const glass = document.documentElement.dataset.style === "glass";
  el.innerHTML = `<div class="sgroup"><div class="sgh"><b>Panel transparency</b><span>How much of the background shows through panels and the menu. Applies to Frosted glass, on all your devices.</span></div>
    <label class="field">Solid ←→ Clear<input type="range" id="lookClarity" min="0" max="100" step="5" value="${look.clarity}"></label>
    <div class="note" id="lookNote">${glass ? (look.clarity == 50 ? "Original look." : look.clarity < 50 ? "More solid than the original." : "Clearer than the original.") : "Switch Style to Frosted glass above to see this."}</div></div>`;
  const r = el.querySelector("#lookClarity"), note = el.querySelector("#lookNote");
  r.oninput = () => {
    setLook({ clarity: +r.value });
    const g = document.documentElement.dataset.style === "glass";   // the style may have been switched since this pane opened
    note.textContent = !g ? "Switch Style to Frosted glass above to see this." : +r.value === 50 ? "Original look." : +r.value < 50 ? "More solid than the original." : "Clearer than the original.";
  };
}

/* ---------- 2. account badge ---------- */
let user = null;
async function who() {
  try { const sb = window.mpSupabase; if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; } catch { return null; }
}
function syncState() { const s = document.getElementById("sync"); return s ? { text: s.textContent.trim(), cls: s.classList.contains("ok") ? "ok" : s.classList.contains("warn") ? "warn" : "" } : { text: "", cls: "" }; }
function badgeHTML(u, big) { const ch = u && u.email ? u.email[0].toUpperCase() : "?"; return `${esc(ch)}${big ? "" : `<i class="${syncState().cls}"></i>`}`; }

function addBadge() {
  const top = document.querySelector("header.top"); if (!top || document.getElementById("acctBtn")) return;
  const b = document.createElement("button");
  b.className = "acct"; b.id = "acctBtn"; b.type = "button"; b.setAttribute("aria-label", "Account");
  b.innerHTML = badgeHTML(user);
  top.insertBefore(b, top.firstChild);
  b.addEventListener("click", openAccount);
  // keep the little sync dot current
  const s = document.getElementById("sync");
  if (s) new MutationObserver(() => { const i = b.querySelector("i"); if (i) i.className = syncState().cls; }).observe(s, { attributes: true, childList: true, characterData: true, subtree: true });
}

function openAccount() {
  const root = document.getElementById("sheetRoot"); if (!root) return;
  const st = syncState();
  root.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet acctpop" role="dialog" aria-modal="true" aria-label="Account">
    <div class="who"><span class="acct">${badgeHTML(user, true)}</span><div><b>${user ? esc(user.email) : "Not signed in"}</b><span>${user ? esc(st.text || "Synced") + " · syncs to every device signed in with this email" : "Using this device only. Sign in to sync your phone and laptop."}</span></div></div>
    <div class="row">${user
      ? `<button type="button" class="btn" data-look="settings">Account &amp; reminders</button><button type="button" class="btn danger" data-look="signout">Sign out</button>`
      : `<button type="button" class="btn primary" data-look="signin">Sign in</button>`}</div>
    <div class="note" style="margin:0">App version ${esc(window.mpVersion || "")}</div>
  </div></div>`;
  root.querySelector(".acctpop").addEventListener("click", async e => {
    const a = e.target.closest("[data-look]"); if (!a) return;
    e.stopPropagation();
    if (a.dataset.look === "settings") {
      root.innerHTML = "";
      try { localStorage.setItem("momentum-planner-v1-setpane", "notify"); } catch {}
      const sbtn = [...document.querySelectorAll("button")].find(x => x.getAttribute("aria-label") === "Settings" || x.dataset.act === "settings");
      if (sbtn) sbtn.click();
    } else if (a.dataset.look === "signout") {
      if (db && db.pending && db.pending() && !confirm("Some changes haven't synced yet and will be lost. Sign out anyway?")) return;
      try { await window.mpSupabase.auth.signOut(); } catch {}
      ["mp.cache.v1", "mp.queue.v1"].forEach(k => { try { localStorage.removeItem(k); } catch {} });
      location.reload();
    } else if (a.dataset.look === "signin") location.reload();
  });
}

/* ---------- 3. expanding pill ---------- */
let origin = null;   // { rect, at } of the button just tapped
const POP_IDS = ["searchBtn", "momBtn", "lvlBtn", "acctBtn"];
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest(POP_IDS.map(i => "#" + i).join(","));
  if (b) origin = { rect: b.getBoundingClientRect(), at: Date.now(), id: b.id };
}, true);
document.addEventListener("keydown", () => { origin = null; }, true);   // keyboard-opened search: no pill animation

function grow(scrim) {
  const o = origin; origin = null;
  if (!o || Date.now() - o.at > 800) return;
  const sheet = scrim.querySelector(".sheet"); if (!sheet) return;
  scrim.classList.add("pillpop");
  scrim.dataset.from = o.id;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const s = sheet.getBoundingClientRect(), b = o.rect;
  // clip the sheet down to the button's shape, then open it out
  const top = Math.max(0, b.top - s.top), left = Math.max(0, b.left - s.left), right = Math.max(0, s.right - b.right), bottom = Math.max(0, s.bottom - b.bottom);
  const r = Math.min(b.height / 2, 24);
  sheet.animate([
    { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${r}px)`, transform: `translateY(${Math.min(0, b.top - s.top) * .2}px)` },
    { clipPath: `inset(0px 0px 0px 0px round 28px)`, transform: "none" },
  ], { duration: 420, easing: "cubic-bezier(.2,.9,.22,1.08)" });
  [...sheet.children].forEach((c, i) => c.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: 120 + i * 25, easing: "ease-out", fill: "backwards" }));
  scrim.animate([{ backgroundColor: "rgba(8,12,18,0)" }, { backgroundColor: "rgba(8,12,18,.28)" }], { duration: 300, easing: "ease-out" });
}

// Reverse: when a pill closes, put a copy back for a moment and shrink it into its button
function shrink(scrim) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const btn = document.getElementById(scrim.dataset.from || ""); if (!btn || !btn.getClientRects().length) return;
  const ghost = document.createElement("div");
  ghost.id = "pillGhost"; ghost.style.cssText = "position:fixed;inset:0;z-index:40;pointer-events:none";
  ghost.appendChild(scrim); document.body.appendChild(ghost);
  scrim.removeAttribute("data-act");
  const sheet = scrim.querySelector(".sheet"); if (!sheet) { ghost.remove(); return; }
  const s = sheet.getBoundingClientRect(), b = btn.getBoundingClientRect();
  const top = Math.max(0, b.top - s.top), left = Math.max(0, b.left - s.left), right = Math.max(0, s.right - b.right), bottom = Math.max(0, s.bottom - b.bottom);
  const r = Math.min(b.height / 2, 24);
  [...sheet.children].forEach(c => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-in", fill: "forwards" }));
  const a = sheet.animate([
    { clipPath: "inset(0px 0px 0px 0px round 28px)" },
    { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${r}px)` },
  ], { duration: 320, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
  scrim.animate([{ backgroundColor: getComputedStyle(scrim).backgroundColor, backdropFilter: getComputedStyle(scrim).backdropFilter }, { backgroundColor: "rgba(8,12,18,0)", backdropFilter: "none" }], { duration: 300, easing: "ease-in", fill: "forwards" });
  a.onfinish = a.oncancel = () => ghost.remove();
  setTimeout(() => ghost.remove(), 600);
}

function watchSheets() {
  const root = document.getElementById("sheetRoot"); if (!root) return;
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.removedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains("pillpop") && !root.querySelector(".scrim")) shrink(n);
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) {
      const scrim = n.classList && n.classList.contains("scrim") ? n : n.querySelector && n.querySelector(".scrim");
      if (scrim) grow(scrim);
      // the Appearance pane gets the transparency slider
      const look = root.querySelector('.setpane[data-pane="appearance"]');
      if (look && !look.querySelector("#mpLook")) { const d = document.createElement("div"); d.id = "mpLook"; look.appendChild(d); renderLook(d); }
    }
  }).observe(root, { childList: true });
}

function slideToPick() {
  const nav = document.getElementById("bnav"); if (!nav) return;
  let x0 = null;
  nav.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") x0 = e.clientX; }, { passive: true });
  nav.addEventListener("pointerup", e => {
    if (x0 == null) return;
    const moved = Math.abs(e.clientX - x0) > 12; x0 = null;
    if (!moved) return;                                   // a plain tap is handled as usual
    const b = document.elementFromPoint(e.clientX, e.clientY)?.closest("#bnav button");
    if (b && b.getAttribute("aria-pressed") !== "true") b.click();
  });
  nav.addEventListener("pointercancel", () => { x0 = null; });
}

async function start() {
  keepLast();
  addBadge(); watchSheets(); slideToPick();
  // the sign-in client is created by boot.js a moment after the page starts
  for (let i = 0; i < 100 && !window.mpSupabase; i++) await new Promise(r => setTimeout(r, 100));
  user = await who();
  const b = document.getElementById("acctBtn"); if (b) b.innerHTML = badgeHTML(user);
  // the session may arrive a moment later (sign-in)
  try { window.mpSupabase && window.mpSupabase.auth.onAuthStateChange((_e, s) => { user = s ? s.user : null; const x = document.getElementById("acctBtn"); if (x) x.innerHTML = badgeHTML(user); }); } catch {}
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
