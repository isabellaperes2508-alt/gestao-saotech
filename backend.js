/* Gestão Saotech — camada de dados gratuita (Supabase)
   Implementa a mesma interface usada pelo painel (db, user, assets),
   então o restante do código não precisa saber onde os dados ficam. */
(function () {
  "use strict";
  const cfg = window.SAOTECH_CONFIG || {};
  const $ = s => document.querySelector(s);

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || /COLE_AQUI/.test(cfg.supabaseUrl + cfg.supabaseAnonKey)) {
    document.addEventListener("DOMContentLoaded", () => {
      mostrarLogin("Configuração pendente: preencha o arquivo config.js com a URL e a chave do seu projeto Supabase (veja o LEIA-ME).", true);
    });
    window.claude = {use: () => new Promise(() => {})};
    return;
  }

  const baseUrl = String(cfg.supabaseUrl).trim().replace(/\/(rest|auth|storage)\/v1\/?.*$/, "").replace(/\/+$/, "");
  const sb = window.supabase.createClient(baseUrl, String(cfg.supabaseAnonKey).trim(), {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}
  });
  window.sb = sb;

  /* ---------- Login ---------- */
  let resolverPronto; const pronto = new Promise(r => { resolverPronto = r; });
  let entrou = false;

  function mostrarLogin(msg, bloqueado){
    const el = $("#login"); if (!el) return;
    el.hidden = false; document.body.classList.add("sem-login");
    const m = $("#login-msg"); if (m) { m.textContent = msg || ""; m.hidden = !msg; }
    if (bloqueado) el.querySelectorAll("input,button").forEach(x => x.disabled = true);
  }
  function esconderLogin(){ const el = $("#login"); if (el) el.hidden = true; document.body.classList.remove("sem-login"); }
  function modo(m){ document.querySelectorAll("#login [data-modo]").forEach(f => f.hidden = f.dataset.modo !== m); }

  let entrando = null;
  function entrar(session){
    if (entrou) return Promise.resolve();
    if (!entrando) entrando = entrar2(session).finally(() => { entrando = null; });
    return entrando;
  }
  async function entrar2(session){
    if (entrou) return;
    const email = (session.user.email || "").toLowerCase();
    const {data: membro, error} = await sb.from("equipe").select("*").eq("email", email).maybeSingle();
    if (error || !membro) {
      await sb.auth.signOut();
      const det = error ? ` (${[error.code, error.message].filter(Boolean).join(": ")})` : "";
      mostrarLogin(error ? (/equipe|relation|schema cache|PGRST205|42P01/i.test(det) ? "O banco ainda não foi preparado: rode o arquivo supabase.sql no SQL Editor do Supabase." + det : "Não foi possível verificar seu cadastro." + det) : `O e-mail ${email} não está cadastrado na equipe. Peça à administração para incluir.`);
      return;
    }
    entrou = true; esconderLogin();
    const sair = $("#btnSair"); if (sair) { sair.hidden = false; sair.onclick = async () => { await sb.auth.signOut(); location.reload(); }; }
    iniciarTempoReal();
    resolverPronto({session, membro});
  }

  document.addEventListener("DOMContentLoaded", async () => {
    $("#f-login")?.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Entrando…";
      const {data, error} = await sb.auth.signInWithPassword({email: $("#l-email").value.trim(), password: $("#l-senha").value});
      btn.disabled = false; btn.textContent = "Entrar";
      if (error) { mostrarLogin(/invalid/i.test(error.message) ? "E-mail ou senha incorretos." : "Não foi possível entrar: " + error.message); return; }
      entrar(data.session);
    });
    $("#l-esqueci")?.addEventListener("click", async () => {
      const email = $("#l-email").value.trim();
      if (!email) { mostrarLogin("Digite seu e-mail acima e clique de novo em Esqueci a senha."); return; }
      const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname});
      mostrarLogin(error ? "Não foi possível enviar: " + error.message : "Enviamos um link para criar uma nova senha. Confira seu e-mail (e a caixa de spam).");
    });
    $("#f-nova")?.addEventListener("submit", async e => {
      e.preventDefault();
      const senha = $("#n-senha").value;
      if (senha.length < 8) { mostrarLogin("A senha precisa ter pelo menos 8 caracteres."); return; }
      const {data, error} = await sb.auth.updateUser({password: senha});
      if (error) { mostrarLogin("Não foi possível salvar a senha: " + error.message); return; }
      modo("entrar"); const {data: s} = await sb.auth.getSession(); if (s.session) entrar(s.session);
    });

    sb.auth.onAuthStateChange((evento, session) => {
      if (evento === "PASSWORD_RECOVERY") { mostrarLogin("Crie sua nova senha."); modo("nova"); return; }
      if (evento === "SIGNED_IN" && session && !document.querySelector('#login [data-modo="nova"]:not([hidden])')) entrar(session);
    });
    const {data: {session}} = await sb.auth.getSession();
    if (session && !/type=recovery/.test(location.hash)) entrar(session); else if (!session) { mostrarLogin(""); modo("entrar"); }
  });

  /* ---------- Banco de documentos ---------- */
  const cache = new Map();          // path -> data
  const carregadas = new Set();     // coleções já lidas
  const subsCol = new Map();        // coleção -> Set(fn)
  const subsDoc = new Map();        // path -> Set(fn)
  const colDe = p => p.split("/").slice(0, -1).join("/");
  const idDe = p => p.split("/").pop();
  const rid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const congelar = d => d;

  function avisar(path){
    const c = colDe(path);
    (subsCol.get(c) || new Set()).forEach(f => { try { f(); } catch (e) { console.error(e); } });
    (subsDoc.get(path) || new Set()).forEach(f => { try { f(); } catch (e) { console.error(e); } });
  }
  function erroDb(error){
    const c = error?.code;
    if (c === "42501" || /row-level security|permission/i.test(error?.message || "")) return {code: "invalid_argument", message: "Sem permissão"};
    if (c === "54000" || /too large/i.test(error?.message || "")) return {code: "invalid_argument", message: "Documento grande demais"};
    return {code: "unavailable", message: error?.message || "Falha de conexão"};
  }
  async function carregarColecao(col, forcar){
    if (carregadas.has(col) && !forcar) return;
    let de = 0; const passo = 1000; const vistos = new Set();
    for (;;) {
      const {data, error} = await sb.from("docs").select("path,data").eq("col", col).range(de, de + passo - 1);
      if (error) throw erroDb(error);
      data.forEach(r => { cache.set(r.path, r.data); vistos.add(r.path); });
      if (data.length < passo) break;
      de += passo;
    }
    if (forcar) for (const p of [...cache.keys()]) if (colDe(p) === col && !vistos.has(p)) cache.delete(p);
    carregadas.add(col);
  }
  function snapDoc(path){
    const d = cache.get(path);
    return {id: idDe(path), exists: d !== undefined, data: () => (d === undefined ? undefined : congelar(d)), metadata: {fromCache: false, hasPendingWrites: false}};
  }
  function snapCol(col, q){
    let docs = [];
    for (const [p, d] of cache) if (colDe(p) === col) docs.push({id: idDe(p), exists: true, data: () => congelar(d), metadata: {}});
    for (const [campo, op, val] of q.where) {
      docs = docs.filter(x => { const v = x.data()?.[campo];
        return op === "==" ? v === val : op === "!=" ? v !== val : op === "<" ? v < val : op === "<=" ? v <= val : op === ">" ? v > val : op === ">=" ? v >= val
          : op === "in" ? val.includes(v) : op === "not-in" ? !val.includes(v) : op === "array-contains" ? Array.isArray(v) && v.includes(val) : true; });
    }
    if (q.ord) { const [f, dir] = q.ord; docs.sort((a, b) => { const x = a.data()?.[f], y = b.data()?.[f]; if (x === y) return 0; if (x === undefined) return 1; if (y === undefined) return -1; return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1); }); }
    else docs.sort((a, b) => a.id < b.id ? -1 : 1);
    if (q.lim) docs = docs.slice(0, q.lim);
    return {docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {fromCache: false, hasPendingWrites: false}};
  }
  function mesclar(base, patch){
    const out = Array.isArray(base) ? base.slice() : {...(base || {})};
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && v.__delete__ === true) { delete out[k]; continue; }
      out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? mesclar(out[k], v) : v;
    }
    return out;
  }
  async function gravar(path, data){
    const anterior = cache.get(path);
    const limpo = JSON.parse(JSON.stringify(data));
    cache.set(path, limpo); avisar(path);
    const {error} = await sb.from("docs").upsert({path, col: colDe(path), data: limpo, updated_at: new Date().toISOString()});
    if (error) { if (anterior === undefined) cache.delete(path); else cache.set(path, anterior); avisar(path); throw erroDb(error); }
  }
  function docRef(path){
    return {
      id: idDe(path), path,
      async get(){ if (!cache.has(path)) { const {data, error} = await sb.from("docs").select("data").eq("path", path).maybeSingle(); if (error) throw erroDb(error); if (data) cache.set(path, data.data); } return snapDoc(path); },
      set(data){ return gravar(path, data); },
      async update(patch){
        let atual = cache.get(path);
        if (atual === undefined) { const {data} = await sb.from("docs").select("data").eq("path", path).maybeSingle(); atual = data?.data; }
        if (atual === undefined) throw {code: "invalid_argument", message: "Documento não existe"};
        return gravar(path, mesclar(atual, patch));
      },
      async delete(){
        const anterior = cache.get(path); cache.delete(path); avisar(path);
        const {error} = await sb.from("docs").delete().eq("path", path);
        if (error) { if (anterior !== undefined) cache.set(path, anterior); avisar(path); throw erroDb(error); }
      },
      onSnapshot(next, onErr){
        const f = () => next(snapDoc(path));
        if (!subsDoc.has(path)) subsDoc.set(path, new Set());
        subsDoc.get(path).add(f);
        (async () => { try { if (!cache.has(path) && !carregadas.has(colDe(path))) await this.get(); f(); } catch (e) { onErr && onErr(e); } })();
        return () => subsDoc.get(path)?.delete(f);
      },
      async acquire(){ return {acquired: true}; },
      collection(sub){ return colRef(path + "/" + sub); }
    };
  }
  function colRef(col, q = {where: [], ord: null, lim: 0}){
    const consulta = {
      where(c, op, v){ return colRef(col, {...q, where: [...q.where, [c, op, v]]}); },
      orderBy(c, dir = "asc"){ return colRef(col, {...q, ord: [c, dir]}); },
      limit(n){ return colRef(col, {...q, lim: n}); },
      async get(){ await carregarColecao(col); return snapCol(col, q); },
      onSnapshot(next, onErr){
        const f = () => next(snapCol(col, q));
        if (!subsCol.has(col)) subsCol.set(col, new Set());
        subsCol.get(col).add(f);
        carregarColecao(col).then(f).catch(e => onErr && onErr(e));
        return () => subsCol.get(col)?.delete(f);
      },
      path: col,
      doc(id){ return docRef(col + "/" + (id || rid())); },
      async add(data){ const r = docRef(col + "/" + rid()); await r.set(data); return r; }
    };
    return consulta;
  }
  const db = {doc: docRef, collection: colRef};

  /* ---------- Tempo real ---------- */
  let canal = null, conectouAntes = false;
  function iniciarTempoReal(){
    canal = sb.channel("docs-saotech")
      .on("postgres_changes", {event: "*", schema: "public", table: "docs"}, ev => {
        if (ev.eventType === "DELETE") { const p = ev.old?.path; if (p && cache.has(p)) { cache.delete(p); avisar(p); } return; }
        const r = ev.new; if (!r?.path) return;
        if (!carregadas.has(r.col) && !subsDoc.has(r.path)) return;
        cache.set(r.path, r.data); avisar(r.path);
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") { if (conectouAntes) ressincronizar(); conectouAntes = true; }
      });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") ressincronizar(); });
  }
  let ressinc = null;
  function ressincronizar(){
    clearTimeout(ressinc);
    ressinc = setTimeout(async () => {
      for (const c of [...carregadas]) { try { await carregarColecao(c, true); (subsCol.get(c) || new Set()).forEach(f => f()); } catch {} }
    }, 400);
  }

  /* ---------- Arquivos (Supabase Storage) ---------- */
  const BUCKET = "anexos";
  const urls = new Map(); // id -> {url, ate}
  const assets = {
    async upload(file){
      const nome = (file.name || "arquivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
      const id = `${new Date().toISOString().slice(0, 7)}/${rid()}-${nome}`;
      const tipo = file.type || "application/octet-stream";
      if (file.size > 20 * 1024 * 1024) throw {code: "too_large", message: "Arquivo maior que 20 MB"};
      const {error} = await sb.storage.from(BUCKET).upload(id, file, {contentType: tipo, upsert: false});
      if (error) throw {code: /size|large/i.test(error.message) ? "too_large" : /quota|limit/i.test(error.message) ? "quota_or_state" : "upstream_error", message: error.message};
      return {id, url: "", sizeBytes: file.size, contentType: tipo};
    },
    async list(){ return {assets: [], usage: {}}; },
    async delete(id){ const {error} = await sb.storage.from(BUCKET).remove([id]); return {deleted: !error}; }
  };
  // Preenche links e imagens marcados com data-blob usando links temporários seguros
  let hidrTimer = null;
  async function hidratar(){
    const els = [...document.querySelectorAll("[data-blob]:not([data-blob-ok])")];
    if (!els.length) return;
    const agora = Date.now();
    const faltam = [...new Set(els.map(e => e.dataset.blob))].filter(id => !(urls.get(id)?.ate > agora + 60000));
    if (faltam.length) {
      const {data} = await sb.storage.from(BUCKET).createSignedUrls(faltam, 6 * 3600);
      (data || []).forEach(x => { if (x.signedUrl) urls.set(x.path, {url: x.signedUrl, ate: agora + 6 * 3600 * 1000}); });
    }
    for (const e of els) {
      const u = urls.get(e.dataset.blob)?.url; if (!u) continue;
      if (e.tagName === "IMG") e.src = u; else e.href = u;
      e.setAttribute("data-blob-ok", "");
    }
  }
  new MutationObserver(() => { clearTimeout(hidrTimer); hidrTimer = setTimeout(() => hidratar().catch(() => {}), 60); })
    .observe(document.documentElement, {childList: true, subtree: true});

  /* ---------- Interface esperada pelo painel ---------- */
  window.claude = {
    async use(nome){
      const {session, membro} = await pronto;
      if (nome === "db") return db;
      if (nome === "assets") return assets;
      if (nome === "user") return {
        isOwner: () => !!membro.admin, canEdit: () => !!membro.admin, can: () => true,
        id: async () => session.user.id, name: async () => membro.nome, pessoa: () => membro.pessoa,
        me: async () => ({id: session.user.id, name: membro.nome, email: membro.email})
      };
      return null; // mcp e outros recursos do Claude não existem na versão independente
    }
  };
})();
