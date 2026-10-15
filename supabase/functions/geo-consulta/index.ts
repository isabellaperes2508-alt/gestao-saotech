// Gestão Saotech — consulta de imóveis vizinhos em bases oficiais (CAR/SICAR, SIGEF e SNCI/INCRA).
// Faz a ponte porque esses servidores não liberam acesso direto pelo navegador (CORS).
const UFS = new Set("ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to".split(" "));
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS"};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), {status, headers: {...CORS, "Content-Type": "application/json"}});

async function buscar(url: string, ms = 15000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, {signal: c.signal, headers: {"User-Agent": "GestaoSaotech/1.0"}}); const txt = await r.text(); return {ok: r.ok, status: r.status, txt}; }
  finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: CORS});
  let p: any; try { p = await req.json(); } catch { return json({erro: "pedido inválido"}, 400); }
  const fonte = String(p.fonte || ""); const uf = String(p.uf || "es").toLowerCase();
  const b = (p.bbox || []).map(Number);
  if (!UFS.has(uf) || b.length !== 4 || b.some(isNaN)) return json({erro: "parâmetros inválidos"}, 400);
  if (Math.abs(b[2] - b[0]) > 0.25 || Math.abs(b[3] - b[1]) > 0.25) return json({erro: "área de busca grande demais"}, 400);
  const bbox = b.map((v: number) => v.toFixed(6)).join(",");
  let tentativas: string[] = [];
  if (fonte === "car") {
    tentativas = [`https://geoserver.car.gov.br/geoserver/sicar/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=sicar:sicar_imoveis_${uf}&outputFormat=application/json&maxFeatures=80&bbox=${bbox},EPSG:4326`];
  } else if (fonte === "sigef" || fonte === "snci") {
    const temas = fonte === "sigef" ? [`certificada_sigef_particular_${uf}`, `certificada_sigef_publico_${uf}`] : [`imoveiscertificados_privado_${uf}`];
    for (const t of temas) for (const fmt of ["geojson", "application/json"])
      tentativas.push(`https://acervofundiario.incra.gov.br/i3geo/ogc.php?tema=${t}&service=WFS&version=1.0.0&request=GetFeature&typeName=${t}&outputFormat=${encodeURIComponent(fmt)}&maxFeatures=80&bbox=${bbox}`);
  } else return json({erro: "fonte desconhecida"}, 400);
  const feats: any[] = []; let falhas = 0, ultimoErro = "";
  for (const u of tentativas) {
    try {
      const r = await buscar(u);
      if (!r.ok) { falhas++; ultimoErro = `HTTP ${r.status}`; continue; }
      const gj = JSON.parse(r.txt);
      if (Array.isArray(gj.features)) { feats.push(...gj.features); if (fonte !== "sigef") break; }
    } catch (e) { falhas++; ultimoErro = String((e as Error)?.name === "AbortError" ? "o servidor oficial não respondeu a tempo" : (e as Error)?.message || e); }
  }
  if (!feats.length && falhas) return json({erro: ultimoErro || "servidor oficial indisponível", features: []}, 200);
  return json({type: "FeatureCollection", features: feats.slice(0, 120)});
});
