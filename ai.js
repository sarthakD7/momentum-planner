// Momentum Planner: bring-your-own AI.
// Stands in for claude.ai's "sample" capability: ai.json(promptOrMessages, { signal, modelTier }) -> parsed JSON.
// Keys stay in this browser's localStorage only. They are never synced or sent anywhere except the chosen provider.

const LS_KEY = "mp.ai.v1";

export const PROVIDERS = {
  anthropic:  { name: "Claude (Anthropic)", model: "claude-sonnet-5-5", quick: "claude-haiku-5-5", keyHint: "sk-ant-…", keyUrl: "https://console.anthropic.com/settings/keys" },
  openai:     { name: "ChatGPT (OpenAI)", model: "gpt-6.2-astra", quick: "gpt-6-luna", keyHint: "sk-…", keyUrl: "https://platform.openai.com/api-keys" },
  gemini:     { name: "Gemini (Google)", model: "gemini-flash-latest", quick: "gemini-3.5-flash-lite", keyHint: "AIza…", keyUrl: "https://aistudio.google.com/app/apikey", note: "Has a free tier." },
  openrouter: { name: "OpenRouter (many models, one key)", model: "openrouter/auto", quick: "openrouter/auto", keyHint: "sk-or-…", keyUrl: "https://openrouter.ai/keys" },
  custom:     { name: "Custom (OpenAI-compatible, e.g. Ollama)", model: "", quick: "", keyHint: "optional", base: "http://localhost:11434/v1" },
};

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
export function setConfig(c) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {}
}
export const configured = (c = getConfig()) => !!(c.provider && PROVIDERS[c.provider] && (c.key || c.provider === "custom") && (c.provider !== "custom" || c.base));

const SYSTEM = "You are the planning assistant inside a personal day-planner app. Reply with a single valid JSON object only: no markdown, no code fences, no text before or after it.";

function fail(code, message) { return Object.assign(new Error(message || code), { code }); }

function toMessages(input) {
  if (typeof input === "string") return [{ role: "user", content: input }];
  return (input || []).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") }));
}

// Pull the JSON object out of a model's text (tolerates code fences or stray words)
export function parseJSON(text) {
  const t = String(text || "").trim();
  if (!t) throw fail("empty_completion");
  try { return JSON.parse(t); } catch {}
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw fail("invalid_json", "The answer didn't come back as JSON.");
}

async function post(url, headers, body, signal) {
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw fail("cancelled");
    throw fail("network", "Couldn't reach the AI provider. Check your connection" + (url.startsWith("http://") ? " and that the local server allows this site (CORS)." : "."));
  }
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && (data.error?.message || data.error || data.message)) || res.statusText;
    if (res.status === 401 || res.status === 403) throw fail("bad_key", String(msg));
    if (res.status === 429) throw fail("rate_limited", String(msg));
    if (res.status === 413 || /context|too long|maximum.*tokens/i.test(String(msg))) throw fail("prompt_too_large", String(msg));
    if (res.status === 404) throw fail("bad_model", String(msg));
    throw fail("provider_error", `${res.status}: ${msg}`);
  }
  return data;
}

async function complete(c, messages, quick, signal) {
  const P = PROVIDERS[c.provider];
  const model = (quick ? (c.quick || P.quick) : (c.model || P.model)) || c.model || P.model;
  if (!model) throw fail("bad_model", "Enter a model name in Settings → AI.");

  if (c.provider === "anthropic") {
    const d = await post("https://api.anthropic.com/v1/messages", {
      "x-api-key": c.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
    }, { model, max_tokens: quick ? 1024 : 8000, system: SYSTEM, messages }, signal);
    if (d.stop_reason === "refusal") throw fail("refused");
    return (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  }

  if (c.provider === "gemini") {
    const d = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": c.key }, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: quick ? 1024 : 8000 },
    }, signal);
    const cand = (d.candidates || [])[0];
    if (!cand && d.promptFeedback?.blockReason) throw fail("refused");
    return (cand?.content?.parts || []).map(p => p.text || "").join("");
  }

  // OpenAI, OpenRouter and any OpenAI-compatible server share one format
  const base = c.provider === "openai" ? "https://api.openai.com/v1" : c.provider === "openrouter" ? "https://openrouter.ai/api/v1" : String(c.base || "").replace(/\/+$/, "");
  const headers = c.key ? { Authorization: "Bearer " + c.key } : {};
  if (c.provider === "openrouter") Object.assign(headers, { "HTTP-Referer": location.origin + location.pathname, "X-Title": "Momentum Planner" });
  const body = { model, messages: [{ role: "system", content: SYSTEM }, ...messages] };
  if (c.provider !== "custom") body.response_format = { type: "json_object" };
  const d = await post(base + "/chat/completions", headers, body, signal);
  const msg = d.choices?.[0]?.message;
  if (msg?.refusal) throw fail("refused");
  return msg?.content || "";
}

// The object the planner uses in place of claude.ai's sample capability
export const sampler = {
  async json(input, opts = {}) {
    const c = getConfig();
    if (!configured(c)) throw fail("capability_disabled");
    const text = await complete(c, toMessages(input), opts.modelTier === "quick", opts.signal);
    return parseJSON(text);
  },
};

// Quick check used by the Settings "Test" button
export async function testConnection(c) {
  const t0 = Date.now();
  const text = await complete(c, [{ role: "user", content: 'Reply with {"ok": true}' }], true);
  const j = parseJSON(text);
  return { ok: j && j.ok === true, ms: Date.now() - t0 };
}

// ---------- Settings → AI pane ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const grp = (title, desc, body) => `<div class="sgroup"><div class="sgh"><b>${title}</b>${desc ? `<span>${desc}</span>` : ""}</div>${body}</div>`;

export function render(el) {
  if (!el) return;
  const c = getConfig(), pv = c.provider || "", P = PROVIDERS[pv];
  el.innerHTML =
    grp("AI provider", "Powers “Plan with AI” and tidying new tasks. Use any AI you have an API key for. Your key is kept only in this browser on this device, never synced, and is sent only to the provider you pick.",
      `<label class="field">Provider<select id="aiProv"><option value=""${!pv ? " selected" : ""}>None: copy the request into any AI chat, then paste the answer</option>${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}"${k === pv ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
       ${P ? `
       ${pv === "custom" ? `<label class="field">Server address<input id="aiBase" value="${esc(c.base || P.base)}" placeholder="${esc(P.base)}" autocomplete="off" spellcheck="false"></label>` : ""}
       <label class="field">API key${pv === "custom" ? " (if your server needs one)" : ""}<input id="aiKey" type="password" value="${esc(c.key || "")}" placeholder="${esc(P.keyHint)}" autocomplete="off" spellcheck="false"></label>
       ${P.keyUrl ? `<div class="note">Get a key: <a href="${P.keyUrl}" target="_blank" rel="noopener">${esc(new URL(P.keyUrl).host)}</a>${P.note ? ` · ${esc(P.note)}` : ""} Usage is billed by the provider to your account.</div>` : ""}
       <div class="row2"><label class="field">Model<input id="aiModel" value="${esc(c.model || "")}" placeholder="${esc(P.model || "model name")}" autocomplete="off" spellcheck="false"></label>
       <label class="field">Quick model (task tidying)<input id="aiQuick" value="${esc(c.quick || "")}" placeholder="${esc(P.quick || "same as Model")}" autocomplete="off" spellcheck="false"></label></div>
       <div class="note">Leave the models blank to use the defaults shown.</div>
       <div class="chiprow"><button type="button" class="btn primary" id="aiSave" style="flex:none">Save</button><button type="button" class="btn" id="aiTest">Test</button>${c.provider ? `<button type="button" class="btn danger" id="aiForget">Remove key</button>` : ""}</div>`
       : `<div class="note">With no provider, “Plan with AI” gives you a request to copy into Claude, ChatGPT or Gemini (any chat subscription works), then you paste the answer back. Chat subscriptions don't include API access, so a key is separate.</div>`}
       <div class="note" id="aiMsg" style="font-weight:600"></div>`);

  const $ = s => el.querySelector(s), say = (t, bad) => { const m = $("#aiMsg"); m.textContent = t; m.style.color = bad ? "var(--warn)" : "var(--good)"; };
  const read = () => {
    const prov = $("#aiProv").value;
    if (!prov) return {};
    return { provider: prov, key: ($("#aiKey")?.value || "").trim(), model: ($("#aiModel")?.value || "").trim(), quick: ($("#aiQuick")?.value || "").trim(), base: ($("#aiBase")?.value || "").trim() };
  };
  $("#aiProv").onchange = () => {
    const prov = $("#aiProv").value, cur = getConfig();
    if (!prov) { setConfig({}); render(el); return; }
    // switching provider: keep nothing from the old one, so a key never goes to the wrong service
    setConfig(cur.provider === prov ? cur : { provider: prov, base: prov === "custom" ? PROVIDERS.custom.base : "" });
    render(el);
  };
  const save = () => { const n = read(); setConfig(n); window.dispatchEvent(new Event("mp-ai-changed")); return n; };
  $("#aiSave") && ($("#aiSave").onclick = () => { const n = save(); say(configured(n) ? "Saved on this device." : n.provider === "custom" ? "Saved. Add the server address to use it." : "Saved. Add your API key to use it.", !configured(n)); });
  $("#aiTest") && ($("#aiTest").onclick = async e => {
    const n = save(); if (!configured(n)) { say("Add your API key first.", true); return; }
    e.target.disabled = true; say("Testing…");
    try { const r = await testConnection(n); say(r.ok ? `Working (${(r.ms / 1000).toFixed(1)} s).` : "Connected, but the reply was unexpected. Try another model.", !r.ok); }
    catch (err) { say(err.code === "bad_key" ? "The provider rejected this key." : err.code === "bad_model" ? "That model name wasn't found." : err.message, true); }
    finally { e.target.disabled = false; }
  });
  $("#aiForget") && ($("#aiForget").onclick = () => { setConfig({}); window.dispatchEvent(new Event("mp-ai-changed")); render(el); say("Key removed from this device."); });
}

window.mpAI = { render };
