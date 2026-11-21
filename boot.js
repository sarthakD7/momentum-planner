// Momentum Planner: boot. Load as a classic <script src="boot.js"></script> BEFORE the app's own scripts.
// window.claude.use("db") is defined synchronously; it resolves once the user is signed in,
// so the app's existing init() just waits on it while the sign-in sheet is shown.
(function () {
  const SUPABASE_URL = "https://gcakpcayhhbqrsijpirf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_ms5jq04QH_sBVYJ9IE2pZg_N4WUeyPT"; // publishable: safe in client code
  const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

  const scriptSrc = document.currentScript && document.currentScript.src;
  let resolveDb, rejectDb;
  const dbReady = new Promise((res, rej) => { resolveDb = res; rejectDb = rej; });
  // Stand-in for claude.ai's "downloads" capability: saves a file through the browser.
  const downloads = {
    async save({ filename, data, mimeType }) {
      const type = mimeType || (/\.json$/i.test(filename) ? "application/json" : /\.csv$/i.test(filename) ? "text/csv" : "text/plain");
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
      const a = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };
  window.claude = { use: async name => (name === "db" ? dbReady : name === "downloads" ? downloads : null) };

  const css = `
  .mp-auth{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:rgba(8,12,18,.55);padding:16px;font-family:Manrope,system-ui,sans-serif}
  .mp-auth form{width:min(380px,100%);background:var(--surface,#fff);color:var(--ink,#141A24);border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:12px;box-shadow:0 12px 34px rgba(0,0,0,.3);box-sizing:border-box}
  .mp-auth h2{margin:0;font-family:"Bricolage Grotesque",Manrope,sans-serif;font-size:22px}
  .mp-auth p{margin:0;font-size:14px;color:var(--muted,#5D6878);line-height:1.5}
  .mp-auth input{height:42px;border-radius:10px;border:1px solid var(--line,#D9DFE6);background:var(--surface,#fff);color:inherit;padding:0 12px;font:inherit}
  .mp-auth button{height:42px;border-radius:10px;border:0;background:var(--accent,#2B59D9);color:var(--accent-ink,#fff);font:inherit;font-weight:700;cursor:pointer}
  .mp-auth button.link{background:none;color:var(--accent,#2B59D9);height:auto;padding:4px}
  .mp-auth .msg{font-size:13px;font-weight:600}
  .mp-auth .msg.bad{color:var(--warn,#B4441F)}`;

  function sheet(supabase) {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const wrap = document.createElement("div"); wrap.className = "mp-auth";
    wrap.innerHTML = `<form>
      <h2>Sign in to sync</h2>
      <p>Enter your email. We'll send a link; open it on this device to sign in. Use the same email on your phone and laptop.</p>
      <input type="email" name="email" autocomplete="email" required placeholder="you@example.com">
      <button type="submit">Email me a sign-in link</button>
      <div class="msg" role="status"></div>
      <button type="button" class="link" data-local>Use without sync on this device</button>
    </form>`;
    const form = wrap.querySelector("form"), msg = wrap.querySelector(".msg");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const email = form.email.value.trim();
      msg.className = "msg"; msg.textContent = "Sending…";
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) { msg.className = "msg bad"; msg.textContent = error.message; return; }
      msg.textContent = "Check your inbox and open the link. This page will update once you're signed in.";
    });
    wrap.querySelector("[data-local]").addEventListener("click", () => { wrap.remove(); resolveDb(null); });
    document.body.appendChild(wrap);
    return () => wrap.remove();
  }

  async function start() {
    let mod;
    try { mod = await import(LIB); } catch (e) { console.error("Couldn't load Supabase", e); resolveDb(null); return; }
    const { createDb } = await import(new URL("supa-db.js", scriptSrc || location.href).href);
    const supabase = mod.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    });
    window.mpSupabase = supabase; // used by Settings -> Sign out in step 2

    const go = session => { resolveDb(createDb(supabase, session.user.id)); };
    const { data: { session } } = await supabase.auth.getSession();
    if (session) { go(session); return; }

    const close = document.body ? sheet(supabase) : null;
    if (!close) document.addEventListener("DOMContentLoaded", () => { const c = sheet(supabase); wait(c); }, { once: true });
    else wait(close);

    function wait(closeSheet) {
      const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => {
        if (s) { sub.subscription.unsubscribe(); closeSheet(); go(s); }
      });
    }
  }
  start().catch(e => { console.error(e); rejectDb(e); });
})();
