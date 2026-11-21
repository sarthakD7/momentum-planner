// Momentum Planner: Supabase shim.
// Mimics the claude.ai artifact db API the app already uses:
//   db.doc(path).get() / .set(data) / .delete() / .onSnapshot(cb, err) / .acquire({holder, ttlMs})
//   db.collection(name).get() / .onSnapshot(cb, err)
// Snapshots: doc -> { id, exists, data() }; query -> { docs: [docSnap], metadata: { fromCache } }
// Works offline: last known data is cached in localStorage and writes queue until the network is back.

const LS_CACHE = "mp.cache.v1";
const LS_QUEUE = "mp.queue.v1";

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const docSnap = (path, data) => {
  const id = path.slice(path.indexOf("/") + 1);
  const copy = data === undefined ? undefined : structuredClone(data);
  return { id, exists: copy !== undefined, data: () => (copy === undefined ? undefined : structuredClone(copy)) };
};

export function createDb(supabase, uid) {
  // path -> data (only for this user)
  const cacheAll = lsGet(LS_CACHE, {});
  if (cacheAll.uid !== uid) { cacheAll.uid = uid; cacheAll.docs = {}; }
  const cache = new Map(Object.entries(cacheAll.docs || {}));
  let queue = lsGet(LS_QUEUE, []).filter(q => q.uid === uid); // [{uid, op:'set'|'delete', path, data}]

  const loadedColls = new Set(); // collections fetched from the server this session
  const docSubs = new Map();     // path -> Set<{cb, err}>
  const collSubs = new Map();    // coll -> Set<{cb, err}>

  let saveTimer = null;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => lsSet(LS_CACHE, { uid, docs: Object.fromEntries(cache) }), 300);
  };
  const persistQueue = () => lsSet(LS_QUEUE, queue);

  const collOf = path => path.split("/")[0];
  const emitDoc = (path, fromCache) => {
    const subs = docSubs.get(path); if (!subs) return;
    const s = { ...docSnap(path, cache.get(path)), metadata: { fromCache } };
    subs.forEach(l => { try { l.cb(s); } catch (e) { console.error(e); } });
  };
  const emitColl = (coll, fromCache) => {
    const subs = collSubs.get(coll); if (!subs) return;
    const prefix = coll + "/";
    const docs = [...cache.entries()].filter(([p]) => p.startsWith(prefix) && p.indexOf("/", prefix.length) < 0).map(([p, d]) => docSnap(p, d));
    const s = { docs, size: docs.length, empty: !docs.length, metadata: { fromCache } };
    subs.forEach(l => { try { l.cb(s); } catch (e) { console.error(e); } });
  };
  const changed = (path, fromCache) => { persist(); emitDoc(path, fromCache); emitColl(collOf(path), fromCache); };

  // ---- server I/O ----
  const err = (e, code) => Object.assign(new Error(e?.message || String(e)), { code: code || e?.code || "error" });

  async function fetchColl(coll) {
    const { data, error } = await supabase.from("docs").select("path,data").eq("coll", coll);
    if (error) throw err(error);
    const pending = new Set(queue.map(q => q.path));
    const prefix = coll + "/";
    const seen = new Set();
    for (const r of data) { seen.add(r.path); if (!pending.has(r.path)) cache.set(r.path, r.data); }
    for (const p of [...cache.keys()]) if (p.startsWith(prefix) && !seen.has(p) && !pending.has(p)) cache.delete(p);
    loadedColls.add(coll);
    persist();
  }

  async function fetchDoc(path) {
    const { data, error } = await supabase.from("docs").select("data").eq("path", path).maybeSingle();
    if (error) throw err(error);
    if (!queue.some(q => q.path === path)) { if (data) cache.set(path, data.data); else cache.delete(path); persist(); }
  }

  async function writeOne(q) {
    if (q.op === "delete") {
      const { error } = await supabase.from("docs").delete().eq("path", q.path);
      if (error) throw err(error);
    } else {
      const { error } = await supabase.from("docs").upsert({ owner: uid, path: q.path, data: q.data }, { onConflict: "owner,path" });
      if (error) throw err(error);
    }
  }

  let flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      while (queue.length && navigator.onLine !== false) {
        const q = queue[0];
        try { await writeOne(q); }
        catch (e) {
          if (/JWT|auth|401|403|42501/i.test(e.message + e.code)) console.error("Write rejected", e);
          else break; // network problem: keep it queued and retry later
        }
        queue.shift(); persistQueue();
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }
  addEventListener("online", () => flush());
  setInterval(() => { if (queue.length) flush(); }, 15000);

  function enqueue(op, path, data) {
    queue = queue.filter(q => q.path !== path); // last write wins per document
    queue.push({ uid, op, path, data });
    persistQueue();
    return flush();
  }

  // ---- realtime: one channel for all of this user's rows ----
  let rtFirst = true;
  supabase.channel("docs:" + uid)
    .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "owner=eq." + uid }, ev => {
      const row = ev.eventType === "DELETE" ? ev.old : ev.new;
      if (!row || !row.path) return;
      if (queue.some(q => q.path === row.path)) return; // local change not yet sent wins
      if (ev.eventType === "DELETE") cache.delete(row.path); else cache.set(row.path, row.data);
      changed(row.path, false);
    })
    .subscribe(status => {
      if (status === "SUBSCRIBED") {
        if (!rtFirst) refreshAll(); // reconnected: catch up on anything missed
        rtFirst = false;
      }
    });

  async function refreshAll() {
    await flush();
    for (const c of collSubs.keys()) { try { await fetchColl(c); emitColl(c, false); } catch {} }
    for (const p of docSubs.keys()) { try { await fetchDoc(p); emitDoc(p, false); } catch {} }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAll(); });

  // ---- public API ----
  function doc(path) {
    return {
      id: path.slice(path.indexOf("/") + 1),
      path,
      async get() {
        try { await fetchDoc(path); } catch (e) { if (!cache.has(path)) throw e; }
        return docSnap(path, cache.get(path));
      },
      set(data) { cache.set(path, structuredClone(data)); changed(path, true); return enqueue("set", path, data); },
      delete() { cache.delete(path); changed(path, true); return enqueue("delete", path); },
      onSnapshot(cb, onErr) {
        const l = { cb, err: onErr || (() => {}) };
        if (!docSubs.has(path)) docSubs.set(path, new Set());
        docSubs.get(path).add(l);
        if (cache.has(path)) queueMicrotask(() => l.cb({ ...docSnap(path, cache.get(path)), metadata: { fromCache: true } }));
        fetchDoc(path).then(() => emitDoc(path, false)).catch(e => l.err(e));
        return () => docSubs.get(path)?.delete(l);
      },
      async acquire({ holder, ttlMs = 8000 } = {}) {
        const { data, error } = await supabase.rpc("acquire_lock", { p_path: path, p_holder: String(holder), p_ttl_ms: ttlMs });
        if (error) throw err(error);
        return { acquired: data === true };
      },
    };
  }

  function collection(coll) {
    return {
      doc: id => doc(coll + "/" + id),
      async get() {
        try { await fetchColl(coll); } catch (e) { if (!loadedColls.has(coll) && ![...cache.keys()].some(p => p.startsWith(coll + "/"))) throw e; }
        const prefix = coll + "/";
        const docs = [...cache.entries()].filter(([p]) => p.startsWith(prefix)).map(([p, d]) => docSnap(p, d));
        return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false } };
      },
      onSnapshot(cb, onErr) {
        const l = { cb, err: onErr || (() => {}) };
        if (!collSubs.has(coll)) collSubs.set(coll, new Set());
        collSubs.get(coll).add(l);
        queueMicrotask(() => emitColl(coll, true));
        fetchColl(coll).then(() => emitColl(coll, false)).catch(e => l.err(e));
        return () => collSubs.get(coll)?.delete(l);
      },
    };
  }

  flush();
  return { doc, collection, flush, pending: () => queue.length };
}

// Installs window.claude.use("db") so the existing app code runs unchanged.
// Other capabilities (mcp, sample, assets, downloads, permissions) return null;
// the app already falls back when they are missing.
export function installClaudeShim(db) {
  window.claude = { use: async name => (name === "db" ? db : null) };
}
