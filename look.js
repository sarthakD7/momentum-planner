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
:root:root[data-style="glass"]{--surface:rgba(255,255,255,calc(.56*var(--ui-op,1)*var(--clash,1)));--surface-2:rgba(255,255,255,calc(.36*var(--ui-op,1)*var(--clash,1)));--g-card:rgba(255,255,255,calc(.42*var(--ui-op,1)*var(--clash,1)))}
@media (prefers-color-scheme: dark){:root:root[data-style="glass"]:not([data-theme="light"]){--surface:rgba(22,28,44,calc(.52*var(--ui-op,1)*var(--clash,1)));--surface-2:rgba(255,255,255,calc(.055*var(--ui-op,1)*var(--clash,1)));--g-card:rgba(255,255,255,calc(.045*var(--ui-op,1)*var(--clash,1)))}}
:root:root[data-style="glass"][data-theme="dark"]{--surface:rgba(22,28,44,calc(.52*var(--ui-op,1)*var(--clash,1)));--surface-2:rgba(255,255,255,calc(.055*var(--ui-op,1)*var(--clash,1)));--g-card:rgba(255,255,255,calc(.045*var(--ui-op,1)*var(--clash,1)))}

/* account badge (Dashboard only) */
.acct{flex:none;width:34px;height:34px;border-radius:50%;padding:0;display:grid;place-items:center;cursor:pointer;position:relative;
  border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);
  background:color-mix(in srgb,var(--accent) 16%,transparent);-webkit-backdrop-filter:blur(12px) saturate(1.4);backdrop-filter:blur(12px) saturate(1.4);
  color:color-mix(in srgb,var(--accent) 70%,var(--ink));font:800 14px var(--f-display);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 14%,transparent)}
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
.scrim.pillpop{align-items:flex-start!important;justify-content:center;padding:calc(var(--toph,48px) + 8px) 8px 8px;background:rgba(8,12,18,.28)}
.scrim.pillpop>.sheet,.scrim.pillpop>form.sheet{width:min(400px,100%);max-height:min(78vh,640px);border-radius:28px!important;margin:0!important;align-self:flex-start!important;box-shadow:0 20px 60px -12px rgba(0,0,0,.55)}
@media (min-width:761px){
  .scrim.pillpop{justify-content:flex-end;padding-right:16px}
  .scrim.pillpop[data-from="acctBtn"]{justify-content:flex-start;padding-left:var(--popL,16px);padding-right:16px}
  .scrim.pillpop[data-from="searchBtn"]{justify-content:center;padding-inline:16px}
  .scrim.pillpop:is([data-from="momBtn"],[data-from="lvlBtn"]){justify-content:flex-end;padding-left:16px;padding-right:var(--popR,16px)}
}
/* no background blur behind pills while they animate: much smoother */
.scrim.pillpop{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
.scrim.pillpop>.sheet{will-change:clip-path}
/* menu highlight: a softer glide, no bounce */
.nind{transition:transform .5s cubic-bezier(.32,.72,0,1),width .45s cubic-bezier(.32,.72,0,1),height .45s cubic-bezier(.32,.72,0,1),opacity .25s ease!important;will-change:transform}
@media (prefers-reduced-motion:reduce){.nind{transition:opacity .2s!important}}
@media (max-width:760px){.bnav{touch-action:none}}

/* ---------- legibility ---------- */
/* panels a bit more solid when the theme fights the scenery (light theme on a night scene, dark theme on a day scene) */
:root[data-theme="light"]:is([data-scene="sea"],[data-scene="aurora"],[data-scene="dusk"]),
:root[data-theme="dark"]:is([data-scene="forest"],[data-scene="alpine"],[data-scene="meadow"]){--clash:1.4}
@media (prefers-color-scheme: light){:root:not([data-theme]):is([data-scene="sea"],[data-scene="aurora"],[data-scene="dusk"]){--clash:1.4}}
@media (prefers-color-scheme: dark){:root:not([data-theme]):is([data-scene="forest"],[data-scene="alpine"],[data-scene="meadow"]){--clash:1.4}}
/* secondary (grey) text: darker in light mode and lighter in dark mode on frosted panels and over scenery */
:root:root:is([data-style="glass"],[data-scene]){--muted:#3E4857}
@media (prefers-color-scheme: dark){:root:root:is([data-style="glass"],[data-scene]):not([data-theme="light"]){--muted:#B9C3D1}}
:root:root:is([data-style="glass"],[data-scene])[data-theme="dark"]{--muted:#B9C3D1}
/* Goals, Overview and Review had no panel behind their text over scenery: give them a light frosted one */
:root[data-scene] :is(#goalsView,#retroView,#overviewView){background:color-mix(in srgb,var(--surface) 72%,transparent)!important;
  -webkit-backdrop-filter:blur(16px) saturate(1.2)!important;backdrop-filter:blur(16px) saturate(1.2)!important;border-color:color-mix(in srgb,var(--g-edge,var(--line)) 60%,transparent)!important}
/* switches (Timeline / Tasks / Both, Day / Week, Grid / List…): frosted backing so labels don't sit on the scenery */
:root:is([data-style="glass"],[data-scene]) .seg{background:color-mix(in srgb,var(--surface) 72%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3)}
:root:is([data-style="glass"],[data-scene]) .seg button[aria-pressed="true"]{color:color-mix(in srgb,var(--accent) 75%,var(--ink))}
/* links and chart labels on frosted panels: a little deeper */
:root:is([data-style="glass"],[data-scene]) :is(.linkbtn,header .link,header .open){color:color-mix(in srgb,var(--accent) 72%,var(--ink))}
:root:is([data-style="glass"],[data-scene]) .clabels span{color:color-mix(in srgb,var(--ink) 78%,transparent)}
/* chart target line label was drawn at 60% opacity */
.cthr{opacity:1;border-top-color:color-mix(in srgb,var(--muted) 55%,transparent)}
/* active menu label and headings over scenery */
.bnav button[aria-pressed="true"]{color:color-mix(in srgb,var(--accent) 70%,var(--ink))}
:root[data-scene] :is(.datelabel,.top h1,#modeTitle,.ovrange){text-shadow:0 0 2px color-mix(in srgb,var(--bg) 90%,transparent),0 1px 10px color-mix(in srgb,var(--bg) 80%,transparent)}

/* ---------- top bar: a frosted pill like the menu (in the page flow on bigger screens, floating on phones) ---------- */
@media (min-width:761px){
  header.top{margin:8px 12px 2px;padding:6px 10px!important;border-radius:22px;
    background:color-mix(in srgb,var(--surface) 62%,transparent)!important;
    -webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5);
    border:1px solid color-mix(in srgb,var(--ink) 10%,transparent);
    box-shadow:0 10px 30px -14px rgba(0,0,0,.4),inset 0 1px 0 color-mix(in srgb,#fff 10%,transparent)}
  header.top :is(.datelabel,h1,#modeTitle){text-shadow:none!important}
}
@media (max-width:760px){
  header.top{position:fixed!important;z-index:31;top:calc(env(safe-area-inset-top,0px) + 8px);
    left:max(12px,env(safe-area-inset-left,0px));right:max(12px,env(safe-area-inset-right,0px));
    padding:6px 8px!important;border-radius:26px;gap:6px;
    background:color-mix(in srgb,var(--surface) 55%,transparent)!important;
    -webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5);
    border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);
    box-shadow:0 10px 30px -10px rgba(0,0,0,.45),inset 0 1px 0 color-mix(in srgb,#fff 10%,transparent)}
  header.top h1{text-shadow:none!important}
  :root[data-scene] header.top :is(.datelabel,h1,#modeTitle){text-shadow:none}
  /* screens with fixed controls above the list: start below the bar */
  .app{padding-top:calc(var(--toph,60px) + 6px)}
  /* screens that are one long list: the list scrolls up behind the bar */
  body:is([data-view="stats"],[data-view="focus"],[data-view="goals"],[data-view="pages"],[data-view="ai"]) .app{padding-top:0}
  body:is([data-view="stats"],[data-view="focus"],[data-view="goals"],[data-view="pages"]) .app .scroll,
  body[data-view="ai"] .aiwrap{padding-top:calc(var(--toph,60px) + 6px);scroll-padding-top:calc(var(--toph,60px) + 6px)}
}
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

const EASE_OUT = "cubic-bezier(.32,.72,0,1)";     // even glide with a soft landing (iOS sheet curve)
const EASE_IN_OUT = "cubic-bezier(.45,0,.2,1)";
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wide = () => innerWidth > 760;
// clip-path inset that crops the sheet down to rectangle b
const insetTo = (s, b, r) => `inset(${Math.max(0, b.top - s.top)}px ${Math.max(0, s.right - b.right)}px ${Math.max(0, s.bottom - b.bottom)}px ${Math.max(0, b.left - s.left)}px round ${r}px)`;
function fadeKids(sheet, show) {
  [...sheet.children].forEach((c, i) => c.animate(show
    ? [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }]
    : [{ opacity: 1 }, { opacity: 0 }],
    show ? { duration: 340, delay: 150 + Math.min(i, 8) * 28, easing: EASE_OUT, fill: "backwards" } : { duration: 150, easing: "ease-in", fill: "forwards" }));
}

function grow(scrim) {
  const o = origin; origin = null;
  if (!o || Date.now() - o.at > 800) return false;
  const sheet = scrim.querySelector(".sheet"); if (!sheet) return false;
  scrim.classList.add("pillpop");
  scrim.dataset.from = o.id;
  // bigger screens: line the pill up with its button (left edge for the account badge, right edge for momentum and level)
  scrim.style.setProperty("--popL", Math.max(12, o.rect.left) + "px");
  scrim.style.setProperty("--popR", Math.max(12, innerWidth - o.rect.right) + "px");
  if (calm()) return true;
  const s = sheet.getBoundingClientRect();
  sheet.animate([{ clipPath: insetTo(s, o.rect, Math.min(o.rect.height / 2, 24)) }, { clipPath: "inset(0px 0px 0px 0px round 28px)" }], { duration: 500, easing: EASE_OUT });
  fadeKids(sheet, true);
  scrim.animate([{ backgroundColor: "rgba(8,12,18,0)" }, { backgroundColor: getComputedStyle(scrim).backgroundColor }], { duration: 400, easing: "ease-out" });
  return true;
}

// Ordinary sheets (Settings, task details…): rise in softly
function rise(scrim) {
  if (calm()) return;
  const sheet = scrim.querySelector(".sheet"); if (!sheet) return;
  const bottom = !wide();   // phones: bottom sheet slides up; bigger screens: centred card settles in
  sheet.animate(bottom
    ? [{ transform: "translateY(40px)", opacity: 0 }, { transform: "none", opacity: 1 }]
    : [{ transform: "translateY(12px) scale(.97)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: EASE_OUT });
  scrim.animate([{ backgroundColor: "rgba(8,12,18,0)" }, { backgroundColor: getComputedStyle(scrim).backgroundColor }], { duration: 320, easing: "ease-out" });
}

// Closing: keep a copy on screen for a moment and play the opening in reverse
function shrink(scrim) {
  if (calm()) return;
  const sheet = scrim.querySelector(".sheet"); if (!sheet) return;
  const pill = scrim.classList.contains("pillpop");
  const btn = pill ? document.getElementById(scrim.dataset.from || "") : null;
  if (pill && (!btn || !btn.getClientRects().length)) return;
  const ghost = document.createElement("div");
  ghost.id = "pillGhost"; ghost.style.cssText = "position:fixed;inset:0;z-index:40;pointer-events:none";
  ghost.appendChild(scrim); document.body.appendChild(ghost);
  scrim.removeAttribute("data-act");
  const bg = getComputedStyle(scrim).backgroundColor;
  let a;
  if (pill) {
    const s = sheet.getBoundingClientRect(), b = btn.getBoundingClientRect();
    fadeKids(sheet, false);
    a = sheet.animate([{ clipPath: "inset(0px 0px 0px 0px round 28px)" }, { clipPath: insetTo(s, b, Math.min(b.height / 2, 24)) }],
      { duration: 380, easing: EASE_IN_OUT, fill: "forwards" });
  } else {
    a = sheet.animate(!wide()
      ? [{ transform: "none", opacity: 1 }, { transform: "translateY(40px)", opacity: 0 }]
      : [{ transform: "none", opacity: 1 }, { transform: "translateY(8px) scale(.97)", opacity: 0 }], { duration: 260, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
  }
  scrim.animate([{ backgroundColor: bg }, { backgroundColor: "rgba(8,12,18,0)" }], { duration: pill ? 380 : 260, easing: "ease-in", fill: "forwards" });
  a.onfinish = a.oncancel = () => ghost.remove();
  setTimeout(() => ghost.remove(), 700);
}

function watchSheets() {
  const root = document.getElementById("sheetRoot"); if (!root) return;
  const isScrim = n => n.nodeType === 1 && n.classList && n.classList.contains("scrim");
  new MutationObserver(muts => {
    const removed = muts.flatMap(m => [...m.removedNodes]).filter(isScrim);
    const added = muts.flatMap(m => [...m.addedNodes]).map(n => isScrim(n) ? n : n.querySelector && n.querySelector(".scrim")).filter(Boolean);
    // closed (nothing left open): play it out
    if (removed.length && !root.querySelector(".scrim")) shrink(removed[removed.length - 1]);
    for (const scrim of added) {
      if (!scrim.isConnected) continue;
      if (!grow(scrim) && !removed.length) rise(scrim);   // a sheet swapped for another (re-render) doesn't animate again
    }
    // the Appearance pane gets the transparency slider
    const look = root.querySelector('.setpane[data-pane="appearance"]');
    if (look && !look.querySelector("#mpLook")) { const d = document.createElement("div"); d.id = "mpLook"; look.appendChild(d); renderLook(d); }
  }).observe(root, { childList: true });
}

// Switching screens: the new screen fades up gently
function watchViews() {
  let last = document.body.dataset.view;
  new MutationObserver(() => {
    const v = document.body.dataset.view; if (v === last) return; last = v;
    if (calm()) return;
    // panes only: never the fixed menu or top bar (moving their parent would make them jump)
    document.querySelectorAll(".app > .pane, .app > .shell > .pane, .app > :not(nav):not(.bnav):not(#bnav):not(header)").forEach(el => {
      if (!el.getClientRects().length || getComputedStyle(el).position === "fixed") return;
      if (el.querySelector("#bnav, .bnav")) return;
      el.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE_OUT });
    });
  }).observe(document.body, { attributes: true, attributeFilter: ["data-view"] });
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

// height of the floating top bar (it can wrap to two lines), so content starts below it
function trackTop() {
  const top = document.querySelector("header.top"); if (!top) return;
  const set = () => { const r = top.getBoundingClientRect(); document.documentElement.style.setProperty("--toph", Math.round(r.bottom) + "px"); };
  new ResizeObserver(set).observe(top); addEventListener("resize", set); set();
}

async function start() {
  keepLast();
  addBadge(); watchSheets(); watchViews(); slideToPick(); trackTop();
  // the sign-in client is created by boot.js a moment after the page starts
  for (let i = 0; i < 100 && !window.mpSupabase; i++) await new Promise(r => setTimeout(r, 100));
  user = await who();
  const b = document.getElementById("acctBtn"); if (b) b.innerHTML = badgeHTML(user);
  // the session may arrive a moment later (sign-in)
  try { window.mpSupabase && window.mpSupabase.auth.onAuthStateChange((_e, s) => { user = s ? s.user : null; const x = document.getElementById("acctBtn"); if (x) x.innerHTML = badgeHTML(user); }); } catch {}
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
