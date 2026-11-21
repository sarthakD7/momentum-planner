// Momentum Planner: blend the phone's system bars into the app.
// Android paints the status bar AND the gesture/navigation bar of an installed web app in one solid colour
// (the page's theme-color); web apps can't make them see-through or colour them separately. So we:
//  1. pick one colour between the top and bottom edges of whatever is behind the app (scenery with its
//     dimming, or the plain theme background), and use it for both bars;
//  2. in the installed app on a phone, fade the scenery into that colour at the top and bottom,
//     so the solid bars read as a continuation of the picture instead of a hard strip.

const meta = document.querySelector('meta[name="theme-color"]') || Object.assign(document.head.appendChild(document.createElement("meta")), { name: "theme-color" });
const cache = new Map();   // image url -> { top: [r,g,b], bottom: [r,g,b] }

function parseColor(c) {
  const m = String(c).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = String(c).trim().match(/^#([0-9a-f]{6})$/i);
  return h ? [0, 2, 4].map(i => parseInt(h[1].slice(i, i + 2), 16)) : null;
}
const hex = rgb => "#" + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function bgColor() {
  // resolve var(--bg) to rgb through a throwaway element
  const d = document.createElement("div"); d.style.cssText = "position:absolute;visibility:hidden;background:var(--bg)"; document.body.appendChild(d);
  const c = parseColor(getComputedStyle(d).backgroundColor); d.remove();
  return c || [14, 18, 24];
}

function topEdgeOf(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const W = 48, H = 96, c = document.createElement("canvas"); c.width = W; c.height = H;
        const g = c.getContext("2d");
        // same framing as the app's background: cover, anchored to the bottom
        const s = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
        g.drawImage(img, (W - w) / 2, H - h, w, h);
        const avg = y => { const px = g.getImageData(0, y, W, 4).data; let r = 0, gg = 0, b = 0, n = 0;
          for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++; } return [r / n, gg / n, b / n]; };
        const edges = { top: avg(0), bottom: avg(H - 4) }; cache.set(url, edges); resolve(edges);
      } catch { resolve(null); }   // a photo from another site can't be read; fall back to the theme colour
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

let busy = 0;
async function sync() {
  const my = ++busy;
  const bg = bgColor();
  let rgb = bg;
  const scene = document.getElementById("scene");
  const url = scene && !scene.hidden && document.documentElement.dataset.scene ? (getComputedStyle(scene).backgroundImage.match(/url\(["']?(.*?)["']?\)$/) || [])[1] : null;
  if (url) {
    const e = await topEdgeOf(url);
    if (e) {
      const dim = (parseFloat(cssVar("--sdim")) || 25) / 100;   // the app lays var(--bg) over the scenery at this strength
      const seen = c => c.map((v, i) => v * (1 - dim) + bg[i] * dim);
      const t = seen(e.top), b = seen(e.bottom);
      rgb = t.map((v, i) => (v + b[i]) / 2);                      // one colour for both bars
    }
  }
  if (my !== busy) return;
  const c = hex(rgb);
  if (c === last) return;            // unchanged: don't touch the page (that would wake the watcher below again)
  last = c;
  meta.setAttribute("content", c);
  document.documentElement.style.setProperty("--sysbar", c);
}
let last = "";

let t = 0;
const later = () => { clearTimeout(t); t = setTimeout(sync, 120); };
new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ["data-scene", "data-theme", "data-style", "data-accent", "style"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", later);
const watchScene = () => { const s = document.getElementById("scene"); if (s) new MutationObserver(later).observe(s, { attributes: true, attributeFilter: ["style", "hidden"] }); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { watchScene(); later(); }); else { watchScene(); later(); }
addEventListener("load", later);

// Fades at the top and bottom edges (installed app, phone widths only). They sit above the scenery
// and under the app's panels, so they only tint the background, never your content.
const fade = document.createElement("style");
fade.textContent = `@media (display-mode: standalone) and (max-width: 760px){
  .mp-edge{position:fixed;left:0;right:0;z-index:0;pointer-events:none}
  .mp-edge.t{top:0;height:calc(env(safe-area-inset-top,0px) + 36px);background:linear-gradient(var(--sysbar,var(--bg)),transparent)}
  .mp-edge.b{bottom:0;height:calc(env(safe-area-inset-bottom,0px) + 64px);background:linear-gradient(transparent,var(--sysbar,var(--bg)))}
}
.mp-edge{display:none}
@media (display-mode: standalone) and (max-width: 760px){.mp-edge{display:block}}`;
document.head.appendChild(fade);
function addEdges() {
  if (document.querySelector(".mp-edge")) return;
  const scene = document.getElementById("scene");
  for (const k of ["t", "b"]) {
    const d = document.createElement("div"); d.className = "mp-edge " + k; d.setAttribute("aria-hidden", "true");
    if (scene && scene.parentNode) scene.parentNode.insertBefore(d, scene.nextSibling); else document.body.prepend(d);
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addEdges); else addEdges();
