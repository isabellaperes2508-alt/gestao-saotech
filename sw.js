/* Gestão Saotech — service worker
   - Instala como app e abre mesmo sem internet (arquivos da página e bibliotecas ficam guardados).
   - Recebe notificações (Web Push) mesmo com o app fechado. */
const CACHE = "saotech-v21";
const ARQUIVOS = ["./", "./index.html", "./config.js", "./backend.js", "./portal.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js"];
const EXTERNOS = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARQUIVOS.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (EXTERNOS.test(url.href)) { // bibliotecas e fontes com versão fixa: guardadas na primeira vez
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok || res.type === "opaque") { const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); } return res; })));
    return;
  }
  if (url.origin !== location.origin) return; // Supabase: sempre pela rede (o app guarda a cópia dos dados)
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("./index.html"))));
});

/* ---------- Notificações ---------- */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {title: "Gestão Saotech", body: e.data ? e.data.text() : ""}; }
  e.waitUntil(self.registration.showNotification(d.title || "Gestão Saotech", {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag,
    icon: "icon-192.png", badge: "icon-192.png", data: {abrir: d.abrir || ""}
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const abrir = e.notification.data?.abrir || "";
  const alvo = new URL(self.registration.scope); if (abrir) alvo.searchParams.set("abrir", abrir);
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({tipo: "abrir", abrir}); return c.focus(); }
    return self.clients.openWindow(alvo.href);
  }));
});
