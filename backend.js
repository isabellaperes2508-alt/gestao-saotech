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

  /* ---------- Modo sem internet: cópia local + fila de envio ---------- */
  const LS_CACHE = "sao.off.cache", LS_FILA = "sao.off.fila", LS_MEMBRO = "sao.off.membro";
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const semRede = err => !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout|ERR_INTERNET/i.test(String(err?.message || err || ""));
  // IndexedDB só para fotos/arquivos que esperam envio
  const idb = (() => {
    let p = null;
    const abrir = () => p || (p = new Promise((ok, falha) => { const r = indexedDB.open("saotech-offline", 1); r.onupgradeneeded = () => r.result.createObjectStore("arquivos"); r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); }));
    const tx = async (modo, f) => { const db = await abrir(); return new Promise((ok, falha) => { const t = db.transaction("arquivos", modo); const st = t.objectStore("arquivos"); const r = f(st); t.oncomplete = () => ok(r?.result); t.onerror = () => falha(t.error); }); };
    return {
      put: (k, v) => tx("readwrite", st => st.put(v, k)),
      get: k => tx("readonly", st => st.get(k)),
      del: k => tx("readwrite", st => st.delete(k)),
      keys: () => tx("readonly", st => st.getAllKeys())
    };
  })();
  const blobsLocais = new Map(); // id -> objectURL de arquivos ainda não enviados

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
    let {data: membro, error} = await sb.from("equipe").select("*").eq("email", email).maybeSingle();
    if (error && semRede(error)) { const salvo = lsGet(LS_MEMBRO, null); if (salvo && salvo.email === email) { membro = salvo; error = null; offline.semConexaoInicial = true; } }
    else if (membro) lsSet(LS_MEMBRO, membro);
    if (!error && !membro) {
      const {data: portal, error: ePortal} = await sb.rpc("portal_dados");
      if (!ePortal && portal) { entrou = true; esconderLogin(); document.body.classList.add("modo-portal"); window.SaotechPortal?.iniciar(sb, portal); return; }
    }
    if (error || !membro) {
      await sb.auth.signOut();
      const det = error ? ` (${[error.code, error.message].filter(Boolean).join(": ")})` : "";
      mostrarLogin(error ? (/equipe|relation|schema cache|PGRST205|42P01/i.test(det) ? "O banco ainda não foi preparado: rode o arquivo supabase.sql no SQL Editor do Supabase." + det : "Não foi possível verificar seu cadastro." + det) : `O e-mail ${email} não está cadastrado na equipe. Peça à administração para incluir.`);
      return;
    }
    entrou = true; esconderLogin();
    if (lsGet("sao.off.dono", "") !== email) { localStorage.removeItem(LS_CACHE); lsSet("sao.off.dono", email); }
    restaurarCache();
    const sair = $("#btnSair"); if (sair) { sair.hidden = false; sair.onclick = async () => { await enviarFila().catch(() => {}); if (fila().length && !confirm("Ainda há alterações feitas sem internet que não foram enviadas. Sair mesmo assim? Elas serão perdidas.")) return; [LS_CACHE, LS_FILA, LS_MEMBRO].forEach(k => localStorage.removeItem(k)); await sb.auth.signOut(); location.reload(); }; }
    membroAtual = membro;
    iniciarTempoReal();
    resolverPronto({session, membro});
    setTimeout(avisarSync, 500);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    $("#f-login")?.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Entrando…";
      let login = $("#l-email").value.trim().toLowerCase();
      if (login && !login.includes("@")) login = login.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ".") + "@clientes.saotech.com.br";
      const {data, error} = await sb.auth.signInWithPassword({email: login, password: $("#l-senha").value});
      btn.disabled = false; btn.textContent = "Entrar";
      if (error) { mostrarLogin(/invalid/i.test(error.message) ? "Usuário ou senha incorretos." : "Não foi possível entrar: " + error.message); return; }
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
    if (session && !/type=recovery/.test(location.hash)) entrar(session);
    else if (!session) {
      const salvo = lsGet(LS_MEMBRO, null);
      if (salvo && !navigator.onLine) { offline.semConexaoInicial = true; entrar({user: {email: salvo.email, id: salvo.email}}); }
      else { mostrarLogin(""); modo("entrar"); }
    }
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
      if (error && semRede(error) && cacheLocal.cols.includes(col)) { carregadas.add(col); offline.on = true; avisarSync(); return; }
      if (error) throw erroDb(error);
      data.forEach(r => { cache.set(r.path, r.data); vistos.add(r.path); });
      if (data.length < passo) break;
      de += passo;
    }
    if (forcar) for (const p of [...cache.keys()]) if (colDe(p) === col && !vistos.has(p)) cache.delete(p);
    // alterações ainda na fila continuam valendo por cima do que veio do servidor
    for (const it of fila()) if (it.t === "doc" && colDe(it.path) === col) cache.set(it.path, it.data);
    carregadas.add(col); salvarCacheDepois();
  }
  /* cópia local para abrir sem internet */
  const cacheLocal = {cols: []};
  function restaurarCache(){
    const c = lsGet(LS_CACHE, null); if (!c) return;
    cacheLocal.cols = c.cols || [];
    for (const [p, d] of c.docs || []) if (!cache.has(p)) cache.set(p, d);
  }
  let tSalvar = null;
  function salvarCacheDepois(){
    clearTimeout(tSalvar);
    tSalvar = setTimeout(() => {
      const cols = [...carregadas].filter(c => !/^data\/fin/.test(c) || membroAtual?.admin);
      const docs = [...cache].filter(([p]) => cols.includes(colDe(p)) || /\/conversa\//.test(p));
      lsSet(LS_CACHE, {cols, docs, em: new Date().toISOString()});
      cacheLocal.cols = cols;
    }, 1500);
  }
  let membroAtual = null;
  /* fila de envio */
  const offline = {on: !navigator.onLine, semConexaoInicial: false, enviando: false};
  const fila = () => lsGet(LS_FILA, []);
  function enfileirar(item){
    const f = fila().filter(x => !(item.t === "doc" && x.t === "doc" && x.path === item.path));
    f.push({...item, em: new Date().toISOString()}); lsSet(LS_FILA, f); avisarSync();
  }
  function avisarSync(){
    const f = fila();
    window.dispatchEvent(new CustomEvent("saotech-sync", {detail: {offline: offline.on || !navigator.onLine, pendentes: f.length, arquivos: f.filter(x => x.t === "arq").length, enviando: offline.enviando}}));
  }
  async function enviarFila(){
    if (offline.enviando || !navigator.onLine) { avisarSync(); return; }
    let f = fila(); if (!f.length) { if (offline.on) { offline.on = false; avisarSync(); } return; }
    offline.enviando = true; avisarSync();
    try {
      for (const it of f.filter(x => x.t === "arq")) {
        const blob = await idb.get(it.id).catch(() => null);
        if (blob) {
          const {error} = await sb.storage.from(BUCKET).upload(it.id, blob, {contentType: it.tipo || blob.type || "application/octet-stream", upsert: true});
          if (error) { if (semRede(error)) throw error; console.warn("arquivo da fila recusado", it.id, error.message); }
        }
        await idb.del(it.id).catch(() => {});
        lsSet(LS_FILA, fila().filter(x => !(x.t === "arq" && x.id === it.id)));
      }
      for (const it of fila().filter(x => x.t === "doc")) {
        const {error} = await sb.from("docs").upsert({path: it.path, col: colDe(it.path), data: it.data, updated_at: new Date().toISOString()});
        if (error) { if (semRede(error)) throw error; console.warn("alteração da fila recusada", it.path, error.message); }
        lsSet(LS_FILA, fila().filter(x => !(x.t === "doc" && x.path === it.path && x.em === it.em)));
      }
      offline.on = false;
    } catch (e) { offline.on = true; }
    finally { offline.enviando = false; avisarSync(); }
  }
  window.addEventListener("online", () => { enviarFila(); setTimeout(ressincronizar, 1500); });
  window.addEventListener("offline", () => { offline.on = true; avisarSync(); });
  setInterval(() => { if (fila().length) enviarFila(); }, 30000);
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
    if (!navigator.onLine) { enfileirar({t: "doc", path, data: limpo}); salvarCacheDepois(); return; }
    const {error} = await sb.from("docs").upsert({path, col: colDe(path), data: limpo, updated_at: new Date().toISOString()});
    if (error && semRede(error)) { offline.on = true; enfileirar({t: "doc", path, data: limpo}); salvarCacheDepois(); return; }
    if (error) { if (anterior === undefined) cache.delete(path); else cache.set(path, anterior); avisar(path); throw erroDb(error); }
    salvarCacheDepois();
    if (fila().length) enviarFila();
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
        if (fila().some(x => x.t === "doc" && x.path === r.path)) return; // a versão local ainda vai subir
        cache.set(r.path, r.data); avisar(r.path); salvarCacheDepois();
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") { enviarFila(); if (conectouAntes || offline.semConexaoInicial) ressincronizar(); conectouAntes = true; offline.semConexaoInicial = false; }
      });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") ressincronizar(); });
  }
  let ressinc = null;
  async function ressincronizarJa(){ for (const c of [...carregadas]) { try { await carregarColecao(c, true); (subsCol.get(c) || new Set()).forEach(f => f()); } catch {} } }
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
    async upload(file, opts){
      const nome = (file.name || "arquivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
      const pasta = opts && opts.pasta ? String(opts.pasta).replace(/[^\w.\-/]+/g, "").replace(/\/+$/, "") : new Date().toISOString().slice(0, 7);
      const id = `${pasta}/${rid()}-${nome}`;
      const tipo = file.type || "application/octet-stream";
      if (file.size > 20 * 1024 * 1024) throw {code: "too_large", message: "Arquivo maior que 20 MB"};
      const guardar = async () => { await idb.put(id, file); blobsLocais.set(id, URL.createObjectURL(file)); enfileirar({t: "arq", id, tipo}); return {id, url: "", sizeBytes: file.size, contentType: tipo, pendente: true}; };
      if (!navigator.onLine) return guardar();
      const {error} = await sb.storage.from(BUCKET).upload(id, file, {contentType: tipo, upsert: false});
      if (error && semRede(error)) { offline.on = true; return guardar(); }
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
    for (const id of new Set(els.map(e => e.dataset.blob))) if (blobsLocais.has(id)) urls.set(id, {url: blobsLocais.get(id), ate: agora + 864e5});
    const faltam = [...new Set(els.map(e => e.dataset.blob))].filter(id => !(urls.get(id)?.ate > agora + 60000));
    if (faltam.length && navigator.onLine) {
      const {data} = await sb.storage.from(BUCKET).createSignedUrls(faltam, 6 * 3600);
      (data || []).forEach(x => { if (x.signedUrl) urls.set(x.path, {url: x.signedUrl, ate: agora + 6 * 3600 * 1000}); });
    }
    for (const e of els) {
      const u = urls.get(e.dataset.blob)?.url; if (!u) continue;
      if (e.tagName === "IMG" || e.tagName === "IFRAME") e.src = u; else e.href = u;
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
        isOwner: () => !!membro.admin, canEdit: () => !!membro.admin,
        can: acao => acao === "data.write" ? (membro.perfil || "operacional") !== "leitura" : true,
        perfil: () => membro.perfil || (membro.admin ? "admin" : "operacional"),
        async equipe(){ const {data, error} = await sb.from("equipe").select("email,pessoa,nome,admin,perfil").order("nome"); if (error) throw erroDb(error); return data || []; },
        async portalAcessos(){ const {data, error} = await sb.from("clientes_acesso").select("usuario,nome,demandas,senha"); if (error) throw erroDb(error); return data || []; },
        async definirSenhaCliente(usuario){ const {data, error} = await sb.rpc("portal_definir_senha", {p_usuario: usuario}); if (error) throw erroDb(error); return data; },
        async criarAcessoCliente(demanda, usuario){ const {data, error} = await sb.rpc("garantir_acesso_cliente", {p_demanda: demanda, p_usuario: usuario || null}); if (error) throw erroDb(error); return data; },
        async responderCliente(usuario, texto, anexos){ const {data, error} = await sb.rpc("portal_resposta", {p_usuario: usuario, p_texto: texto || "", p_anexos: anexos || []}); if (error) throw erroDb(error); return data; },
        async agendarCliente(usuario, acao, ag){ const {data, error} = await sb.rpc("portal_agendar", {p_usuario: usuario, p_acao: acao, p_ag: ag}); if (error) throw {code: "upstream_error", message: error.message}; return data; },
        async lixeira(){ const {data, error} = await sb.from("lixeira").select("path,col,data,apagado_em,apagado_por").order("apagado_em", {ascending: false}); if (error) throw erroDb(error); return data || []; },
        async restaurarLixeira(path){ const {data, error} = await sb.rpc("restaurar_lixeira", {p_path: path}); if (error) throw erroDb(error); await ressincronizarJa(); return data; },
        async expurgarLixeira(path){ const {data, error} = await sb.rpc("expurgar_lixeira", {p_path: path}); if (error) throw erroDb(error); return data; },
        async backups(){ const {data, error} = await sb.from("backups").select("id,criado_em,tipo,docs,bytes").order("criado_em", {ascending: false}).limit(12); if (error) throw erroDb(error); return data || []; },
        async backupDados(id){ const {data, error} = await sb.from("backups").select("dados").eq("id", id).single(); if (error) throw erroDb(error); return data.dados; },
        async fazerBackup(){ const {data, error} = await sb.rpc("fazer_backup", {p_tipo: "manual"}); if (error) throw erroDb(error); return data; },
        async baixarArquivo(id){ const {data, error} = await sb.storage.from(BUCKET).download(id); if (error) throw {code: "upstream_error", message: error.message}; return data; },
        async copiarArquivo(de, para){ const {error} = await sb.storage.from(BUCKET).copy(de, para); if (error) throw {code: "upstream_error", message: error.message}; return para; },
        async salvarPush(sub){ const {error} = await sb.rpc("salvar_push", {p_sub: sub, p_ua: navigator.userAgent}); if (error) throw erroDb(error); },
        async removerPush(endpoint){ await sb.rpc("remover_push", {p_endpoint: endpoint}); },
        async linkAgenda(novo){ const {data, error} = await sb.rpc("link_agenda", {p_novo: !!novo}); if (error) throw erroDb(error); return data; },
        async geoConsulta(fonte, uf, bbox){ const {data, error} = await sb.functions.invoke("geo-consulta", {body: {fonte, uf, bbox}}); if (error) throw {message: error.message || "falha na consulta"}; return data; },
        sincronia: () => ({offline: offline.on || !navigator.onLine, pendentes: fila().length}),
        enviarPendentes: () => enviarFila(),
        async definirPerfil(email, perfil){ const {error} = await sb.from("equipe").update({perfil, admin: perfil === "admin"}).eq("email", email); if (error) throw erroDb(error); },
        id: async () => session.user.id, name: async () => membro.nome, pessoa: () => membro.pessoa,
        me: async () => ({id: session.user.id, name: membro.nome, email: membro.email})
      };
      return null; // mcp e outros recursos do Claude não existem na versão independente
    }
  };
})();
