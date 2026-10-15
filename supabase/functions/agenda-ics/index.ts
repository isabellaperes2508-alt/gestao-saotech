// Gestão Saotech — feed de agenda (.ics) para assinar no Google Agenda / iPhone / Outlook.
// O link leva um token secreto por pessoa; quem não tem o token não vê nada.
const URL_BASE = Deno.env.get("SUPABASE_URL") || "https://lvbxiqmpnvzuaevdqedt.supabase.co";
const CHAVE_PUBLICA = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_ttC0S27oyWJAWgo6w-kAWw_Qd5mrfZ5";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = (url.searchParams.get("t") || "").replace(/[^a-f0-9]/gi, "").slice(0, 64);
  if (!token) return new Response("link incompleto", {status: 400});
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/agenda_ics`, {
    method: "POST",
    headers: {"Content-Type": "application/json", apikey: CHAVE_PUBLICA, ...(CHAVE_PUBLICA.startsWith("eyJ") ? {Authorization: `Bearer ${CHAVE_PUBLICA}`} : {})},
    body: JSON.stringify({p_token: token})
  });
  if (!r.ok) return new Response("agenda indisponível", {status: 502});
  const ics = await r.json();
  if (!ics) return new Response("link inválido ou revogado", {status: 404});
  return new Response(ics, {headers: {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'inline; filename="saotech.ics"',
    "Cache-Control": "max-age=900"
  }});
});
