// Gestão Saotech — envio de notificações Web Push.
// Chamado pelo banco (pg_net). Só funciona com a chave VAPID da Saotech:
// a chave pública é fixa aqui e a privada vem do Vault do banco em cada chamada.
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLICA = "BKdUPtWQQ9vbr6sclHK_-sJddstUogtQPWvnHpqVnFBHIInREdG0Imw-sBbHWzbgL3bXoCVz6IJULu3r2LGY1PM";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  let corpo: any;
  try { corpo = await req.json(); } catch { return new Response("json inválido", {status: 400}); }
  const {vapidPrivada, envios} = corpo || {};
  if (!vapidPrivada || !Array.isArray(envios)) return new Response("faltam dados", {status: 400});
  webpush.setVapidDetails("mailto:contato@saotech.com.br", VAPID_PUBLICA, vapidPrivada);
  const resultado = await Promise.all(envios.slice(0, 200).map(async (e: any) => {
    try {
      const r = await webpush.sendNotification(e.sub, JSON.stringify(e.payload), {TTL: 86400, urgency: "high"});
      return {endpoint: e.sub?.endpoint, status: r.statusCode};
    } catch (err: any) {
      return {endpoint: e.sub?.endpoint, status: err?.statusCode || 0, erro: String(err?.body || err?.message || err).slice(0, 200)};
    }
  }));
  return new Response(JSON.stringify(resultado), {headers: {"Content-Type": "application/json"}});
});
