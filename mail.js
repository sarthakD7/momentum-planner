// Momentum Planner: Settings → Email scan. Talks to the `mailscan` Edge Function.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const grp = (title, desc, body) => `<div class="sgroup"><div class="sgh"><b>${title}</b>${desc ? `<span>${desc}</span>` : ""}</div>${body}</div>`;
const when = iso => iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never";

async function call(action, extra = {}) {
  const sb = window.mpSupabase;
  const { data, error } = await sb.functions.invoke("mailscan", { body: { action, ...extra } });
  if (error) { let msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return data;
}

async function render(el) {
  if (!el) return;
  const sb = window.mpSupabase;
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) { el.innerHTML = grp("Email scan", "", `<p class="note" style="margin:0">Sign in to sync to use the email scan.</p>`); return; }
  el.innerHTML = `<p class="note" style="margin:0">Loading…</p>`;
  let st;
  try { st = await call("status"); }
  catch (e) { el.innerHTML = grp("Email scan", "", `<p class="note" style="margin:0;color:var(--warn)">${esc(e.message)}</p>`); return; }
  const L = st.link;
  const setup = !st.google || !st.ai
    ? `<div class="note" style="color:var(--warn);font-weight:600">Setup isn't finished: ${[!st.google && "Google access (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)", !st.ai && "an AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY)"].filter(Boolean).join(" and ")} must be added in Supabase → Edge Functions → Secrets.</div>`
    : "";
  el.innerHTML =
    grp("Email scan", "Three times a day (7:43am, 12:43pm, 5:43pm) your Gmail is read, and upcoming meetings, classes, exams and deadlines are added to “Found in emails” in your Brief. Read-only: nothing in your mailbox is ever changed.",
      `${setup}
       ${L ? `<div class="note">Connected to <b>${esc(L.email || "Gmail")}</b> · last scan ${esc(when(L.last_scan))}</div>
              ${L.last_result ? `<div class="note">${esc(L.last_result)}</div>` : ""}
              <label class="field">Which emails (Gmail search)<input id="msQuery" value="${esc(L.query)}" autocomplete="off" spellcheck="false"></label>
              <div class="chiprow"><button type="button" class="btn primary" data-ms="scan" style="flex:none"${st.ai ? "" : " disabled"}>Scan now</button><button type="button" class="btn" data-ms="query">Save search</button><button type="button" class="btn danger" data-ms="disconnect">Disconnect Gmail</button></div>`
            : `<div class="chiprow"><button type="button" class="btn primary" data-ms="connect" style="flex:none"${st.google ? "" : " disabled"}>Connect Gmail</button></div>
               <div class="note">Opens Google to allow read-only access to your Gmail. Use the Gmail account your institute mail is forwarded to.</div>`}
       <div class="note" id="msMsg" style="font-weight:600"></div>`);

  const say = (t, bad) => { const m = el.querySelector("#msMsg"); m.textContent = t; m.style.color = bad ? "var(--warn)" : "var(--good)"; };
  el.onclick = async e => {
    const b = e.target.closest("[data-ms]"); if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.ms === "connect") { say("Opening Google…"); const { url } = await call("start"); location.href = url; return; }
      if (b.dataset.ms === "scan") { say("Scanning… this can take up to a couple of minutes."); const r = await call("scan"); await render(el); say(r.error || r.result || "Done.", !!r.error); return; }
      if (b.dataset.ms === "query") { await call("query", { query: el.querySelector("#msQuery").value }); say("Saved. The next scan uses it."); }
      if (b.dataset.ms === "disconnect") { if (!confirm("Stop scanning this Gmail account? Items already found stay in your Brief.")) return; await call("disconnect"); await render(el); say("Gmail disconnected."); return; }
    } catch (err) { say(err.message || String(err), true); }
    finally { b.disabled = false; }
  };
}

// Back from Google: open Settings on the Email scan pane
if (location.hash === "#mail-connected") {
  history.replaceState(null, "", location.pathname + location.search);
  addEventListener("load", () => setTimeout(() => {
    const t = document.querySelector('[aria-label="Settings"], button[title="Settings"]') || [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Settings");
    try { localStorage.setItem("momentum-planner-v1-setpane", "mail"); } catch {}
    if (t) t.click();
  }, 1500));
}

window.mpMail = { render };
