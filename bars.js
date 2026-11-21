// Momentum Planner: blend the phone's system bars into the app.
// Android paints the status bar (and on some phones the navigation bar) in one solid colour: the page's
// theme-color. Web apps can't make it see-through, so we set that colour to match the top edge of whatever
// is behind the app right now: the scenery (with its dimming) or the plain theme background.

const meta = document.querySelector('meta[name="theme-color"]') || Object.assign(document.head.appendChild(document.createElement("meta")), { name: "theme-color" });
const cache = new Map();   // image url -> [r,g,b] of its top edge

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
        const px = g.getImageData(0, 0, W, 4).data; let r = 0, gg = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++; }
        const rgb = [r / n, gg / n, b / n]; cache.set(url, rgb); resolve(rgb);
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
    const top = await topEdgeOf(url);
    if (top) {
      const dim = (parseFloat(cssVar("--sdim")) || 25) / 100;   // the app lays var(--bg) over the scenery at this strength
      rgb = top.map((v, i) => v * (1 - dim) + bg[i] * dim);
    }
  }
  if (my === busy) meta.setAttribute("content", hex(rgb));
}

let t = 0;
const later = () => { clearTimeout(t); t = setTimeout(sync, 120); };
new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ["data-scene", "data-theme", "data-style", "data-accent", "style"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", later);
const watchScene = () => { const s = document.getElementById("scene"); if (s) new MutationObserver(later).observe(s, { attributes: true, attributeFilter: ["style", "hidden"] }); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { watchScene(); later(); }); else { watchScene(); later(); }
addEventListener("load", later);
