/* Gestão Saotech — portal do cliente + agendamentos no chat (compartilhado com a equipe)
   O cliente vê apenas os próprios processos (etapa, andamento, documentos pendentes, agenda)
   e conversa com a equipe. Os dados chegam por funções do servidor que filtram tudo pelo login. */
(function () {
  "use strict";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const hoje = () => new Date().toLocaleDateString("sv-SE");
  const fData = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", {day: "2-digit", month: "2-digit", year: "numeric"}) : "";
  const fDataLonga = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", {weekday: "long", day: "2-digit", month: "long"}) : "";
  const fDM = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", {day: "2-digit", month: "2-digit"}) : "";
  const fHora = ts => new Date(ts).toLocaleTimeString("pt-BR", {hour: "2-digit", minute: "2-digit"});
  const EQUIPE = {"moises-bruno": "Moisés Bruno", "joao-marcos": "João Marcos", "moises-junior": "Moisés Júnior", "isabella-cleto": "Isabella Cleto"};
  const quem = de => de === "cliente" ? "Cliente" : (EQUIPE[de] || "Equipe Saotech");

  /* ================= Agendamentos no chat (usado pelo portal e pela equipe) ================= */
  const TIPOS = ["Visita técnica", "Reunião", "Levantamento de campo", "Entrega de documentos", "Outro"];
  const LOCAIS = ["Escritório Saotech", "Endereço do cliente", "Na propriedade", "Outro"];
  const STATUS = {
    solicitado: {t: "Aguardando confirmação", c: "warn"},
    remarcacao: {t: "Remarcação proposta", c: "warn"},
    confirmado: {t: "Confirmado", c: "ok"},
    cancelado: {t: "Cancelado", c: "crit"}
  };
  const localTxt = ag => ag.local === "Outro" ? (ag.localTexto || "Outro local") : ag.local + (ag.localTexto ? " — " + ag.localTexto : "");
  function formHtml(modo, ag, procs){
    // modo: "novo" | "remarcar" | "cancelar"
    if (modo === "cancelar") return `<form class="ag-form" data-agform="cancelar" data-agid="${esc(ag.id)}">
      <b>Cancelar agendamento</b>
      <label class="f">Motivo do cancelamento<textarea name="motivo" rows="2" required placeholder="Explique o motivo"></textarea></label>
      <div class="ag-acts"><button type="button" class="btn sm" data-agfechar>Voltar</button><button class="btn sm danger">Cancelar agendamento</button></div></form>`;
    const a = ag || {};
    const minData = hoje();
    return `<form class="ag-form" data-agform="${modo}" ${a.id ? `data-agid="${esc(a.id)}"` : ""}>
      <b>${modo === "remarcar" ? "Remarcar agendamento" : "Solicitar agendamento"}</b>
      <div class="ag-grid">
        <label class="f">Tipo<select name="tipo" ${modo === "remarcar" ? "disabled" : ""}>${TIPOS.map(t => `<option ${t === (a.tipo || "Visita técnica") ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        ${procs && procs.length > 1 && modo === "novo" ? `<label class="f">Processo<select name="demanda">${procs.map(p => `<option value="${esc(p.id)}">${esc(p.codigo)} · ${esc(p.rotulo || "")}</option>`).join("")}</select></label>` : ""}
        <label class="f">Data<input type="date" name="data" required min="${minData}" value="${esc(a.data || "")}"></label>
        <label class="f">Horário<input type="time" name="hora" required value="${esc(a.hora || "")}"></label>
      </div>
      <fieldset class="ag-locais"><legend>Local</legend>${LOCAIS.map(l => `<label><input type="radio" name="local" value="${l}" ${l === (a.local || "Escritório Saotech") ? "checked" : ""}> ${l}</label>`).join("")}</fieldset>
      <label class="f">Endereço ou complemento do local<input name="localTexto" value="${esc(a.localTexto || "")}" placeholder="Obrigatório se escolher Outro (ex.: Rua…, nº, cidade)"></label>
      ${modo === "remarcar" ? `<label class="f">Motivo da remarcação<textarea name="motivo" rows="2" required placeholder="Explique por que precisa remarcar"></textarea></label>` : `<label class="f">Observação (opcional)<input name="obs" value="${esc(a.obs || "")}" placeholder="Ex.: levar documentos, ponto de referência…"></label>`}
      <div class="ag-acts"><button type="button" class="btn sm" data-agfechar>Cancelar</button><button class="btn sm primary">${modo === "remarcar" ? "Enviar nova proposta" : "Enviar solicitação"}</button></div>
    </form>`;
  }
  function lerForm(form){
    const f = new FormData(form); const modo = form.dataset.agform;
    const out = {id: form.dataset.agid || undefined};
    if (modo === "cancelar") { out.motivo = String(f.get("motivo") || "").trim(); if (!out.motivo) return {erro: "Informe o motivo do cancelamento."}; return {acao: "cancelar", ag: out}; }
    out.data = f.get("data"); out.hora = f.get("hora"); out.local = f.get("local") || "Escritório Saotech"; out.localTexto = String(f.get("localTexto") || "").trim();
    if (!out.data || !out.hora) return {erro: "Escolha a data e o horário."};
    if (out.data < hoje()) return {erro: "Escolha uma data a partir de hoje."};
    if (out.local === "Outro" && !out.localTexto) return {erro: "Descreva o local escolhido em Outro."};
    if (modo === "remarcar") { out.motivo = String(f.get("motivo") || "").trim(); if (!out.motivo) return {erro: "Para remarcar, informe o motivo."}; return {acao: "remarcar", ag: out}; }
    out.tipo = f.get("tipo"); out.obs = String(f.get("obs") || "").trim(); if (f.get("demanda")) out.demanda = f.get("demanda");
    return {acao: "solicitar", ag: out};
  }
  function cardHtml(ag, meuLado){
    const st = STATUS[ag.status] || STATUS.solicitado;
    const aguardandoOutro = ["solicitado", "remarcacao"].includes(ag.status) && ag.lado === meuLado;
    const possoConfirmar = ["solicitado", "remarcacao"].includes(ag.status) && ag.lado !== meuLado;
    const ativo = ag.status !== "cancelado";
    const hist = (ag.historico || []).map(h => `<li><b>${esc(quem(h.de))}</b> ${h.acao === "solicitou" ? "solicitou" : h.acao === "confirmou" ? "confirmou" : h.acao === "remarcou" ? `propôs ${fData(h.data)} às ${esc(h.hora)} · ${esc(localTxt(h))}` : "cancelou"}${h.motivo ? ` — <i>${esc(h.motivo)}</i>` : ""} <span>${fData(h.em)} ${fHora(h.em)}</span></li>`).join("");
    return `<div class="ag-card ag-${ag.status}">
      <div class="ag-top"><span class="ag-ic">📅</span><b>${esc(ag.tipo)}</b><span class="ag-st ${st.c}">${st.t}</span></div>
      <div class="ag-quando">${esc(fDataLonga(ag.data))} · <b>${esc(ag.hora)}</b></div>
      <div class="ag-local">📍 ${esc(localTxt(ag))}</div>
      ${ag.obs ? `<div class="ag-obs">${esc(ag.obs)}</div>` : ""}
      ${ag.motivo && ag.status !== "confirmado" ? `<div class="ag-motivo">Motivo: ${esc(ag.motivo)}</div>` : ""}
      ${aguardandoOutro ? `<div class="ag-espera">Aguardando ${meuLado === "cliente" ? "a equipe Saotech" : "o cliente"} confirmar.</div>` : ""}
      ${ativo ? `<div class="ag-acts">${possoConfirmar ? `<button type="button" class="btn sm primary" data-agacao="confirmar" data-agid="${esc(ag.id)}">Confirmar</button>` : ""}<button type="button" class="btn sm" data-agacao="remarcar" data-agid="${esc(ag.id)}">Remarcar</button><button type="button" class="btn sm ghost" data-agacao="cancelar" data-agid="${esc(ag.id)}">Cancelar</button></div>` : ""}
      ${hist ? `<details class="ag-hist"><summary>Histórico</summary><ul>${hist}</ul></details>` : ""}
    </div>`;
  }
  // devolve, para cada agendamento, o id da última mensagem que o menciona (é ali que o cartão aparece)
  function ultimasPorAg(msgs){ const u = {}; for (const m of msgs || []) if (m.tipo === "agendamento" && m.ag) u[m.ag] = m.id; return u; }
  async function prepararImagem(file){
    if (!/^image\//.test(file.type) || file.type === "image/gif" || file.size < 900000) return file;
    try {
      const bmp = await createImageBitmap(file); const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.82));
      return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {type: "image/jpeg"}) : file;
    } catch { return file; }
  }
  window.SaotechAg = {formHtml, lerForm, cardHtml, ultimasPorAg, localTxt, prepararImagem, STATUS};

  /* ================= Pix (BR Code estático) — usado pela equipe e pelo portal ================= */
  window.SaotechPix = (() => {
    const semAcento = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 .,@+\-\/]/g, "").trim();
    const campo = (id, v) => id + String(v.length).padStart(2, "0") + v;
    function crc16(t){ let c = 0xFFFF; for (let i = 0; i < t.length; i++) { c ^= t.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; } return c.toString(16).toUpperCase().padStart(4, "0"); }
    function normChave(k, tipo){
      k = String(k || "").trim();
      if (tipo === "telefone") { const d = k.replace(/\D/g, ""); return "+" + (d.startsWith("55") && d.length >= 12 ? d : "55" + d); }
      if (tipo === "documento") return k.replace(/\D/g, "");
      if (tipo === "email") return k.toLowerCase();
      if (tipo === "aleatoria") return k.toLowerCase();
      if (/@/.test(k)) return k.toLowerCase();
      const d = k.replace(/\D/g, "");
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k)) return k.toLowerCase();       // chave aleatória
      if (/^\+/.test(k)) return "+" + d;                                       // telefone já com +55
      if (d.length === 11 && /^\(?\d{2}\)?\s?9/.test(k) && !/[.\-]\d{2}$/.test(k.replace(/\s/g, ""))) return "+55" + d; // celular (27) 9xxxx-xxxx
      if (d.length === 11 || d.length === 14) return d;                          // CPF / CNPJ
      if (d.length === 13 && d.startsWith("55")) return "+" + d;
      return k;
    }
    function payload({chave, tipo, nome, cidade, valor, txid, descricao}){
      const gui = campo("00", "br.gov.bcb.pix") + campo("01", normChave(chave, tipo)) + (descricao ? campo("02", semAcento(descricao).slice(0, 40)) : "");
      let p = campo("00", "01") + campo("26", gui) + campo("52", "0000") + campo("53", "986")
        + (valor > 0 ? campo("54", Number(valor).toFixed(2)) : "") + campo("58", "BR")
        + campo("59", semAcento(nome).toUpperCase().slice(0, 25) || "SAOTECH") + campo("60", semAcento(cidade).toUpperCase().slice(0, 15) || "VITORIA")
        + campo("62", campo("05", (String(txid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25)) || "***"));
      p += "6304"; return p + crc16(p);
    }
    let lib = null;
    const carregar = () => lib || (lib = new Promise((ok, falha) => { if (window.qrcode) return ok(window.qrcode); const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"; s.onload = () => ok(window.qrcode); s.onerror = () => { lib = null; falha(new Error("QR indisponível")); }; document.head.appendChild(s); }));
    async function qrSvg(texto, px = 220){ const q = (await carregar())(0, "M"); q.addData(texto); q.make(); const n = q.getModuleCount(); const cel = Math.max(2, Math.floor(px / (n + 8))); return q.createSvgTag({cellSize: cel, margin: cel * 4, scalable: true}); }
    async function preencherQR(el){ for (const x of el.querySelectorAll("[data-pixqr]")) { try { x.innerHTML = await qrSvg(x.dataset.pixqr); } catch { x.innerHTML = '<p class="sub">Use o código copia e cola abaixo.</p>'; } } }
    return {payload, qrSvg, preencherQR, normChave, crc16};
  })();

  /* ================= Documento para imprimir/salvar em PDF (proposta) ================= */
  window.SaotechDoc = (() => {
    const brl = v => (Number(v) || 0).toLocaleString("pt-BR", {style: "currency", currency: "BRL"});
    const dt = iso => iso ? new Date(String(iso).length <= 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR") : "";
    const e = t => String(t ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
    function propostaHtml(pr, d, logo){
      const itens = pr.itens || [];
      const pg = pr.pagamento || {};
      const cond = pg.texto || (pg.modo === "À vista" ? "Pagamento à vista." : pg.modo === "Entrada + parcelas" ? `Entrada de ${brl(pg.entrada)} e saldo em ${pg.n || 1} parcela(s) mensal(is).` : pg.modo === "Parcelado" ? `${pg.n || 1} parcela(s) mensal(is).` : "");
      return `<div class="doc-prop">
        <div class="rc-top">${logo ? `<img src="${logo}" alt="Saotech Geotecnologia">` : "<b>SAOTECH GEOTECNOLOGIA</b>"}<div><div class="rc-t">PROPOSTA</div><div class="rc-n">Nº ${e(pr.numero || "")} · ${dt(pr.emitidaEm || pr.criadaEm)}</div></div></div>
        <table class="rc-tab"><tr><td>Cliente</td><td><b>${e((d.cliente || "").split(/\s+[—–]\s+/)[0])}</b></td></tr>
          ${d.imovel || (d.cliente || "").includes("—") ? `<tr><td>Imóvel</td><td>${e(d.imovel || d.cliente.split(/\s+[—–]\s+/)[1])}</td></tr>` : ""}
          ${d.municipio ? `<tr><td>Município</td><td>${e(d.municipio)}</td></tr>` : ""}${d.areaHa ? `<tr><td>Área aproximada</td><td>${String(d.areaHa).replace(".", ",")} ha</td></tr>` : ""}</table>
        ${pr.apresentacao ? `<p>${e(pr.apresentacao).replace(/\n/g, "<br>")}</p>` : ""}
        <h4>Serviços</h4>
        <table class="doc-itens"><thead><tr><th>Descrição</th><th>Valor</th></tr></thead><tbody>${itens.map(i => `<tr><td>${e(i.desc).replace(/\n/g, "<br>")}</td><td>${brl(i.valor)}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td>Total</td><td>${brl(pr.total)}</td></tr></tfoot></table>
        ${pr.inclui ? `<h4>O que está incluído</h4><p>${e(pr.inclui).replace(/\n/g, "<br>")}</p>` : ""}
        <h4>Condições</h4>
        <table class="rc-tab">${cond ? `<tr><td>Pagamento</td><td>${e(cond)}</td></tr>` : ""}${pr.prazoDias ? `<tr><td>Prazo de execução</td><td>${e(pr.prazoDias)} dias${pr.prazoObs ? " · " + e(pr.prazoObs) : ""}</td></tr>` : ""}${pr.validade ? `<tr><td>Validade da proposta</td><td>até ${dt(pr.validade)}</td></tr>` : ""}</table>
        ${pr.obs ? `<p class="doc-obs">${e(pr.obs).replace(/\n/g, "<br>")}</p>` : ""}
        ${pr.status === "aceita" && pr.aceite ? `<div class="doc-aceite"><b>Proposta aceita eletronicamente</b><br>por ${e(pr.aceite.nome)} em ${new Date(pr.aceite.em).toLocaleString("pt-BR")}${pr.aceite.ip ? ` · IP ${e(pr.aceite.ip)}` : ""} · pelo Portal do Cliente Saotech</div>`
          : `<div class="rc-ass"><div class="rc-linha"></div><b>Moisés Bruno</b><span>Saotech Geotecnologia</span></div>`}
      </div>`;
    }
    const CSS = `body{font-family:Poppins,Arial,sans-serif;color:#2E3319;margin:0;padding:28px;font-size:13.5px;line-height:1.55}.doc-prop,.doc-memo{max-width:760px;margin:0 auto}
      .rc-top{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #2E3319;padding-bottom:12px;margin-bottom:16px}.rc-top img{height:44px}
      .rc-t{font-family:"Bricolage Grotesque",Poppins,sans-serif;font-weight:700;font-size:22px;letter-spacing:.12em;text-align:right}.rc-n{font-size:12px;color:#656B51;text-align:right}
      h4{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5C6B3D;margin:18px 0 6px}table{width:100%;border-collapse:collapse}
      .rc-tab td{padding:5px 8px;border-bottom:1px solid #EAEBDA;vertical-align:top}.rc-tab td:first-child{color:#656B51;width:34%}
      .doc-itens th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#656B51;border-bottom:2px solid #2E3319;padding:6px 8px}
      .doc-itens td{padding:7px 8px;border-bottom:1px solid #EAEBDA;vertical-align:top}.doc-itens td:last-child,.doc-itens th:last-child{text-align:right;white-space:nowrap}
      .doc-itens tfoot td{font-weight:700;font-size:15px;border-bottom:0;border-top:2px solid #2E3319}
      .doc-aceite{margin-top:22px;border:1.5px solid #5C6B3D;border-radius:10px;padding:10px 14px;background:#EFF2E0}
      .rc-ass{margin:46px auto 0;text-align:center;width:280px}.rc-linha{border-top:1px solid #2E3319;margin-bottom:4px}.rc-ass b,.rc-ass span{display:block}.rc-ass span{font-size:12px;color:#656B51}
      .doc-obs{color:#3A3F28;background:#F7F7EC;border-radius:8px;padding:8px 12px}
      .memo-txt{text-align:justify;text-indent:2.5em}.memo-cab td{padding:3px 8px}.vert td,.vert th{border:1px solid #D9DBC4;padding:3px 6px;font-size:11.5px;text-align:center}.vert th{background:#F2F3E6}
      @page{margin:16mm}@media print{body{padding:0}}`;
    function imprimir(titulo, corpo){
      const w = window.open("", "_blank");
      if (!w) { alert("Libere as janelas pop-up deste site para gerar o PDF."); return; }
      w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${e(titulo)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Poppins:wght@400;600&display=swap"><style>${CSS}</style></head><body>${corpo}<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
      w.document.close();
    }
    return {propostaHtml, imprimir, CSS, brl, dt};
  })();

  /* ================= Notificações (Web Push), usadas pela equipe e pelo portal ================= */
  window.SaotechPush = (() => {
    const VAPID = "BKdUPtWQQ9vbr6sclHK_-sJddstUogtQPWvnHpqVnFBHIInREdG0Imw-sBbHWzbgL3bXoCVz6IJULu3r2LGY1PM";
    const chave = s => { const p = "=".repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const instalado = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const suportado = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && location.protocol === "https:";
    const reg = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, f) => setTimeout(() => f(new Error("O app ainda está carregando. Tente de novo em alguns segundos.")), 6000))]);
    async function estado(){
      if (!suportado()) return ios && !instalado() ? "ios-instalar" : "sem-suporte";
      if (Notification.permission === "denied") return "bloqueado";
      try { const s = await (await reg()).pushManager.getSubscription(); return s && Notification.permission === "granted" ? "ativo" : "inativo"; } catch { return "inativo"; }
    }
    async function ativar(salvar){
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error(perm === "denied" ? "bloqueado" : "Permissão não concedida.");
      const r = await reg();
      let s = await r.pushManager.getSubscription();
      if (!s) s = await r.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: chave(VAPID)});
      await salvar(s.toJSON()); return true;
    }
    async function desativar(remover){ const s = await (await reg()).pushManager.getSubscription(); if (s) { try { await remover(s.endpoint); } catch {} await s.unsubscribe(); } }
    async function renovar(salvar){ try { if (!suportado() || Notification.permission !== "granted") return; const s = await (await reg()).pushManager.getSubscription(); if (s) await salvar(s.toJSON()); } catch {} }
    return {estado, ativar, desativar, renovar, ios, instalado};
  })();

  /* ================= Leitor de PDF (miniaturas e páginas) com pdf.js ================= */
  window.SaotechPdf = (() => {
    const BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
    let p = null;
    function carregar(){
      if (p) return p;
      p = new Promise((ok, falha) => {
        if (window.pdfjsLib) return ok(window.pdfjsLib);
        const s = document.createElement("script"); s.src = BASE + "pdf.min.js";
        s.onload = async () => { const lib = window.pdfjsLib; if (!lib) { p = null; return falha(new Error("pdf.js")); }
          try { const t = await (await fetch(BASE + "pdf.worker.min.js")).text(); lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([t], {type: "text/javascript"})); } catch { lib.GlobalWorkerOptions.workerSrc = BASE + "pdf.worker.min.js"; }
          ok(lib); };
        s.onerror = () => { p = null; falha(new Error("Leitor de PDF indisponível")); };
        document.head.appendChild(s);
      });
      return p;
    }
    const docs = new Map();
    function abrir(chave, obterBlob){
      if (!docs.has(chave)) docs.set(chave, (async () => { const lib = await carregar(); const b = await obterBlob(); const data = new Uint8Array(await b.arrayBuffer()); return lib.getDocument({data, isEvalSupported: false}).promise; })().catch(e => { docs.delete(chave); throw e; }));
      return docs.get(chave);
    }
    const mini = new Map(); let fila = Promise.resolve();
    function miniatura(chave, obterBlob, largura = 300){
      if (mini.has(chave)) return mini.get(chave);
      const pr = fila = fila.then(async () => {
        const doc = await abrir(chave, obterBlob); const pg = await doc.getPage(1);
        const v0 = pg.getViewport({scale: 1}); const vp = pg.getViewport({scale: largura / v0.width});
        const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        await pg.render({canvasContext: cv.getContext("2d"), viewport: vp}).promise;
        return cv.toDataURL("image/jpeg", .82);
      }).catch(() => null);
      mini.set(chave, pr); return pr;
    }
    async function renderizar(chave, obterBlob, el){
      el.innerHTML = `<p class="pdf-carr">Abrindo PDF…</p>`;
      try {
        const doc = await abrir(chave, obterBlob); if (!el.isConnected) return;
        el.innerHTML = "";
        const larg = Math.max(260, Math.min((el.clientWidth || 800) - 8, 1000)); const n = Math.min(doc.numPages, 60);
        for (let i = 1; i <= n; i++) {
          if (!el.isConnected) return;
          const pg = await doc.getPage(i); const v0 = pg.getViewport({scale: 1});
          const dpr = Math.min(2, window.devicePixelRatio || 1); const vp = pg.getViewport({scale: larg / v0.width * dpr});
          const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height); cv.className = "pdf-pg"; cv.style.width = larg + "px";
          el.appendChild(cv); await pg.render({canvasContext: cv.getContext("2d"), viewport: vp}).promise;
        }
        if (doc.numPages > n) el.insertAdjacentHTML("beforeend", `<p class="pdf-carr">Mostrando ${n} de ${doc.numPages} páginas. Baixe o arquivo para ver tudo.</p>`);
      } catch { if (el.isConnected) el.innerHTML = `<p class="pdf-carr">Não foi possível mostrar a prévia deste PDF. Use o botão Baixar.</p>`; }
    }
    return {carregar, miniatura, renderizar};
  })();

  /* ================= Portal do cliente ================= */
  const ETAPAS = ["Orçamento", "Aguardando entrada", "Campo", "Escritório", "Protocolo", "Entregue", "Concluída"];
  const ETAPA_DESC = {
    "Orçamento": "Entendemos o que você precisa, conferimos os documentos do imóvel e enviamos a proposta com valores e prazos.",
    "Aguardando entrada": "Com a proposta aceita, aguardamos o pagamento da entrada para reservar a data do trabalho de campo.",
    "Campo": "A equipe vai ao imóvel medir os limites com receptores GNSS de precisão, implantar marcos e registrar fotos. Os confrontantes podem acompanhar.",
    "Escritório": "Processamos as medições, calculamos área e perímetro, desenhamos a planta e escrevemos o memorial descritivo com os confrontantes.",
    "Protocolo": "Os documentos são protocolados no órgão responsável (INCRA/SIGEF, cartório, prefeitura ou órgão ambiental) e acompanhamos a análise.",
    "Entregue": "Planta, memorial e demais documentos ficam disponíveis aqui no portal para você ver e baixar.",
    "Concluída": "Serviço encerrado. Os documentos continuam guardados aqui no portal."
  };
  const EXPLICA = {
    "Orçamento": "Estamos preparando a proposta do seu serviço.",
    "Aguardando entrada": "Proposta aprovada. Assim que a entrada for confirmada, agendamos o trabalho de campo.",
    "Campo": "Nossa equipe está na etapa de levantamento de campo do imóvel.",
    "Escritório": "Estamos processando os dados de campo e preparando plantas, memoriais e documentos.",
    "Protocolo": "O processo foi protocolado e aguarda análise do órgão responsável.",
    "Entregue": "Os documentos do serviço foram entregues.",
    "Concluída": "Serviço concluído. Obrigado pela confiança!",
    "Pausada": "O processo está pausado no momento. Fale com a equipe pelo chat para saber mais."
  };
  const fDia = ts => { const d = new Date(ts).toLocaleDateString("sv-SE"); return d === hoje() ? "Hoje" : new Date(ts).toLocaleDateString("pt-BR", {weekday: "long", day: "2-digit", month: "short"}); };
  const saud = () => { const h = new Date().getHours(); return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };
  let sb = null, dados = null, timer = null, enviando = false, form = null, erroForm = "", avEditar = null, avNota = 0, pushEst = "";
  const fTam = b => !b ? "" : b > 1048576 ? (b / 1048576).toLocaleString("pt-BR", {maximumFractionDigits: 1}) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const brlP = v => (Number(v) || 0).toLocaleString("pt-BR", {style: "currency", currency: "BRL"});
  let propForm = null, pixAberto = null, ptDoc = null, ptSel = new Set(), ptBaixando = "";
  const baixarBlob = (b, nome) => { const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); };
  const ehImg = d => /^image\//.test(d.tipo || "") || /\.(jpe?g|png|webp|gif)$/i.test(d.nome || "");
  const ehPdf = d => /pdf/i.test(d.tipo || "") || /\.pdf$/i.test(d.nome || "");
  const obterArq = id => async () => { const {data, error} = await sb.storage.from("anexos").download(id); if (error) throw error; return data; };
  let zipP = null;
  const carregarZip = () => zipP || (zipP = new Promise((ok, falha) => { if (window.JSZip) return ok(window.JSZip); const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; s.onload = () => ok(window.JSZip); s.onerror = () => { zipP = null; falha(new Error("Sem internet para compactar.")); }; document.head.appendChild(s); }));
  const miniHtml = d => ehImg(d) ? `<img data-blob="${esc(d.id)}" data-noprev alt="">` : ehPdf(d) ? `<img data-ptth="${esc(d.id)}" alt=""><span class="anx-ext">PDF</span>` : `<span class="anx-ext grande">${esc((String(d.nome || "").split(".").pop() || "ARQ").toUpperCase().slice(0, 5))}</span>`;
  function propostaHtml(p){
    const pr = p.fin?.proposta; if (!pr) return "";
    const pg = pr.pagamento || {};
    const cond = pg.texto || (pg.modo === "À vista" ? "À vista" : pg.modo === "Entrada + parcelas" ? `Entrada de ${brlP(pg.entrada)} + ${pg.n || 1} parcela(s)` : pg.modo === "Parcelado" ? `${pg.n || 1} parcela(s)` : "");
    const resumo = `<div class="pt-prop-itens">${(pr.itens || []).map(i => `<div><span>${esc(i.desc)}</span><b>${brlP(i.valor)}</b></div>`).join("")}<div class="tot"><span>Total</span><b>${brlP(pr.total)}</b></div></div>
      <div class="pt-prop-cond">${cond ? `<span>💳 ${esc(cond)}</span>` : ""}${pr.prazoDias ? `<span>⏱ Execução em ${esc(pr.prazoDias)} dias</span>` : ""}${pr.validade ? `<span>📅 Válida até ${fData(pr.validade)}</span>` : ""}</div>`;
    if (pr.status === "aceita") return `<div class="card pt-prop ok" style="margin-top:12px"><div class="conv-h"><h3>Proposta ${esc(pr.numero)} · aceita ✅</h3><button type="button" class="btn sm ghost" data-proppdf="${esc(p.id)}">PDF</button></div><p class="sub" style="margin:0">Aceita por ${esc(pr.aceite?.nome || "")} em ${pr.aceite ? new Date(pr.aceite.em).toLocaleString("pt-BR") : ""}.</p></div>`;
    if (pr.status === "recusada") return `<div class="card pt-prop" style="margin-top:12px"><h3>Proposta ${esc(pr.numero)}</h3><p class="sub" style="margin:0">Você pediu ajustes. A equipe vai enviar uma nova versão por aqui.</p></div>`;
    return `<div class="card pt-prop destaque" style="margin-top:12px"><div class="conv-h"><div><span class="label">Aguardando sua resposta</span><h3>Proposta ${esc(pr.numero)}</h3></div><button type="button" class="btn sm" data-proppdf="${esc(p.id)}">Ver completa (PDF)</button></div>
      ${pr.apresentacao ? `<p class="sub" style="margin:0 0 8px">${esc(pr.apresentacao)}</p>` : ""}${resumo}
      ${propForm === p.id + ":aceitar" ? `<form class="pt-aceite" data-propaceite="${esc(p.id)}"><label class="f">Digite seu nome completo para aceitar<input name="nome" required minlength="5" autocomplete="name" value="${esc(dados.nome || "")}"></label>
          <label class="av-aut"><input type="checkbox" name="ok" required> Li a proposta e concordo com os serviços, valores e condições.</label>
          <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn sm ghost" data-propcancel>Cancelar</button><button class="btn primary">Aceitar proposta</button></div></form>`
        : propForm === p.id + ":ajuste" ? `<form class="pt-aceite" data-propajuste="${esc(p.id)}"><label class="f">O que você gostaria de ajustar?<textarea name="motivo" rows="3" required></textarea></label>
          <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn sm ghost" data-propcancel>Cancelar</button><button class="btn primary">Enviar para a equipe</button></div></form>`
        : `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="btn primary" data-propacao="${esc(p.id)}:aceitar">Aceitar proposta</button><button type="button" class="btn" data-propacao="${esc(p.id)}:ajuste">Pedir ajuste</button></div>`}
    </div>`;
  }
  function pagamentosHtml(p){
    const ps = p.fin?.parcelas || []; if (!ps.length) return "";
    const pix = dados.pix;
    const hj = hoje();
    return `<div class="card" style="margin-top:12px"><h3>Pagamentos</h3>${ps.map(x => {
      const st = x.pago ? ["Pago", "ok"] : x.vencimento && x.vencimento < hj ? ["Em atraso", "crit"] : ["A vencer", ""];
      const aberto = pixAberto === p.id + ":" + x.id;
      let cod = "";
      if (!x.pago && pix && aberto) cod = window.SaotechPix.payload({chave: pix.chave, tipo: pix.tipo, nome: pix.nome, cidade: pix.cidade, valor: x.valor, txid: ((p.codigo || "").replace(/\W/g, "") + "P" + String(x.id).slice(0, 4)).slice(0, 25)});
      return `<div class="pt-parc"><div class="grow"><b>${esc(x.rotulo)}</b><span class="sub">${brlP(x.valor)}${x.vencimento ? " · vence " + fData(x.vencimento) : ""}${x.pago && x.pagoEm ? " · pago em " + fData(x.pagoEm) : ""}</span></div><span class="due ${st[1]}">${st[0]}</span>
        ${!x.pago && pix ? `<button type="button" class="btn sm ${aberto ? "" : "lima"}" data-ptpix="${esc(p.id)}:${esc(x.id)}">${aberto ? "Fechar" : "Pagar com Pix"}</button>` : ""}</div>
        ${cod ? `<div class="pt-pix"><div class="pix-qr" data-pixqr="${esc(cod)}"></div><div class="grow"><label class="f">Pix copia e cola<textarea readonly rows="3">${esc(cod)}</textarea></label><button type="button" class="btn sm primary" data-copiapix="${esc(cod)}">Copiar código</button><p class="sub">Recebedor: ${esc(pix.nome || "")}. Depois de pagar, envie o comprovante pelo chat (📎).</p></div></div>` : ""}`;
    }).join("")}</div>`;
  }
  function docsHtml(p){
    const ds = (p.docs || []).slice().reverse();
    if (!ds.length) return `<div class="card" style="margin-top:12px" id="pt-docs"><h3>Documentos do imóvel</h3><p class="sub" style="margin:0">Quando a equipe liberar CCIR, ITR, matrícula, mapa, memorial e os demais documentos, eles aparecem aqui para você ver, baixar ou salvar tudo de uma vez.</p></div>`;
    const n = ds.filter(d => ptSel.has(d.id)).length;
    return `<div class="card" style="margin-top:12px" id="pt-docs"><div class="conv-h"><div><span class="label">${ds.length} arquivo${ds.length > 1 ? "s" : ""}</span><h3>Documentos do imóvel</h3></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${n ? `<button type="button" class="btn sm" data-ptzip="sel">Baixar ${n} selecionado${n > 1 ? "s" : ""}${n > 1 ? " (ZIP)" : ""}</button>` : ""}<button type="button" class="btn sm primary" data-ptzip="tudo" ${ptBaixando ? "disabled" : ""}>${ptBaixando || "⬇ Baixar tudo (ZIP)"}</button></div></div>
      <div class="pt-docs">${ds.map(d => `<div class="pt-docit ${ptSel.has(d.id) ? "sel" : ""}">
        <label class="pt-docchk" title="Selecionar"><input type="checkbox" data-ptsel2="${esc(d.id)}" ${ptSel.has(d.id) ? "checked" : ""} aria-label="Selecionar ${esc(d.nome)}"></label>
        <button type="button" class="pt-docth" data-ptver="${esc(d.id)}" aria-label="Ver ${esc(d.nome)}">${miniHtml(d)}</button>
        <div class="grow"><b>${esc(d.rotulo || "Documento")}</b><span class="sub">${esc(d.nome)}${d.tam ? " · " + fTam(d.tam) : ""}${d.em ? " · " + fData(d.em) : ""}</span>
          <div class="pt-docacts"><button type="button" class="btn sm" data-ptver="${esc(d.id)}">Ver</button><button type="button" class="btn sm" data-ptbaixa="${esc(d.id)}">Baixar</button></div></div>
      </div>`).join("")}</div></div>`;
  }
  function visorHtml(p){
    const ds = (p.docs || []).slice().reverse(); const d = ds.find(x => x.id === ptDoc); if (!d) return "";
    return `<div class="pt-visor" role="dialog" aria-modal="true" aria-label="${esc(d.nome)}">
      <div class="pt-vh"><button type="button" class="btn primary" data-ptvoltar>← Voltar</button><div class="grow"><b>${esc(d.rotulo || "Documento")}</b><span class="sub">${esc(d.nome)}</span></div><button type="button" class="btn sm lima" data-ptbaixa="${esc(d.id)}">⬇ Baixar</button></div>
      <div class="pt-vgrid"><div class="pt-vb" data-id="${esc(d.id)}"></div>
        <aside class="pt-vside"><span class="label">Outros documentos</span><div class="pt-vlist">${ds.filter(x => x.id !== d.id).map(x => `<button type="button" class="anx-si" data-ptver="${esc(x.id)}"><span class="th">${miniHtml(x)}</span><span class="t"><span class="nm">${esc(x.rotulo || x.nome)}</span><span class="sub">${esc(x.nome)}</span></span></button>`).join("") || `<p class="sub">Nenhum outro documento.</p>`}</div></aside></div></div>`;
  }
  function visorConteudo(el, d){
    if (ehImg(d)) el.innerHTML = `<img class="anx-img" data-blob="${esc(d.id)}" data-noprev alt="${esc(d.nome)}">`;
    else if (ehPdf(d)) { el.innerHTML = `<div class="pdf-pags"></div>`; window.SaotechPdf.renderizar(d.id, obterArq(d.id), el.firstChild); }
    else el.innerHTML = `<div class="anx-semprev"><p>Este arquivo não tem prévia.</p><button type="button" class="btn primary" data-ptbaixa="${esc(d.id)}">Baixar arquivo</button></div>`;
  }
  async function baixarDocs(lista, nomeZip){
    const arqs = [];
    for (const [i, d] of lista.entries()) { ptBaixando = `Preparando ${i + 1} de ${lista.length}…`; const b = document.querySelector('[data-ptzip="tudo"]'); if (b) b.textContent = ptBaixando; try { arqs.push([d.nome, await obterArq(d.id)()]); } catch {} }
    ptBaixando = "";
    if (!arqs.length) { alert("Não foi possível baixar agora. Verifique a internet e tente de novo."); render(); return; }
    if (arqs.length === 1) { baixarBlob(arqs[0][1], arqs[0][0]); render(); return; }
    const JSZip = await carregarZip(); const z = new JSZip(); const usados = new Set();
    arqs.forEach(([n0, b]) => { let n = n0, i = 2; while (usados.has(n)) n = n0.replace(/(\.[^.]+)?$/, ` (${i++})$1`); usados.add(n); z.file(n, b); });
    baixarBlob(await z.generateAsync({type: "blob"}), nomeZip + ".zip"); render();
  }
  function imovelHtml(p){
    const im = p.imovelDados || {}; const g = p.geo || {};
    const u = im.tipo === "urbano";
    const nf = v => v == null || v === "" ? "" : String(v).replace(".", ",");
    const l = (u ? [["Inscrição imobiliária", im.inscricao], ["Endereço", [[im.logradouro, im.numero].filter(Boolean).join(", "), im.complemento, im.bairro, im.municipio, im.cep ? "CEP " + im.cep : ""].filter(Boolean).join(" · ")], ["Loteamento", im.loteamento], ["Quadra / lote", [im.quadra && "Qd. " + im.quadra, im.lote && "Lt. " + im.lote].filter(Boolean).join(" · ")], ["Área do terreno", im.areaTerrenoM2 != null ? nf(im.areaTerrenoM2) + " m²" : ""], ["Área construída", im.areaConstruidaM2 != null ? nf(im.areaConstruidaM2) + " m²" : ""]]
      : [["Área", (g.areaHa || im.areaHa || p.areaHa) ? nf(g.areaHa || im.areaHa || p.areaHa) + " ha" : ""], ["Perímetro", g.perimetro ? nf(g.perimetro) + " m" : ""], ["Código do imóvel (SNCR)", im.codigoIR], ["CCIR", im.ccir], ["ITR (NIRF)", im.itr], ["CAR", im.car], ["Município", im.municipio || p.municipio]])
      .concat([["Matrícula", im.matricula], ["CIB", im.cib], ["Geocódigo", im.geocodigo], ["Nº do processo", im.numProcesso]]).filter(([, v]) => v);
    const temMapa = g.lat || (g.poligono || []).length;
    if (!l.length && !temMapa) return "";
    return `<div class="card" style="margin-top:12px"><div class="conv-h"><div><span class="label">${u ? "Imóvel urbano" : "Imóvel rural"}${p.propriedadeN ? " · propriedade " + p.propriedadeN : ""}</span><h3>${esc(im.denominacao || p.imovel || "Seu imóvel")}</h3></div></div>
      ${temMapa ? `<div class="pt-mapa" data-ptmapa="${esc(p.id)}"></div><p class="sub" style="margin:6px 0 0">${(g.poligono || []).length ? "Limites medidos pela Saotech sobre imagem de satélite." : "Localização aproximada do imóvel."}</p>` : ""}
      ${l.length ? `<div class="pt-imdados">${l.map(([k, v]) => `<div><span class="label">${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}</div>`;
  }
  async function desenharMapas(el){
    const box = el.querySelector("[data-ptmapa]:not([data-ok])"); if (!box || typeof carregarLeaflet !== "function") return;
    const p = (dados.processos || []).find(x => x.id === box.dataset.ptmapa); const g = p?.geo; if (!g) return;
    box.setAttribute("data-ok", "");
    try {
      const L = await carregarLeaflet(); if (!box.isConnected) return;
      const m = L.map(box, {scrollWheelZoom: false, attributionControl: true}); const base = camadasBase(L); base.sat.addTo(m); L.control.layers({"Satélite": base.sat, "Ruas": base.ruas}, {}, {position: "topright"}).addTo(m);
      if ((g.poligono || []).length > 2) { const pol = L.polygon(g.poligono, {color: "#D9E15A", weight: 3, fillOpacity: .15}).addTo(m); m.fitBounds(pol.getBounds().pad(.25)); }
      else { L.circleMarker([g.lat, g.lng], {radius: 9, color: "#D9E15A", weight: 3, fillOpacity: .5}).addTo(m); m.setView([g.lat, g.lng], 15); }
      box.__mapa = m; setTimeout(() => m.invalidateSize(), 80);
    } catch { box.innerHTML = `<p class="sub" style="padding:20px">Mapa indisponível sem internet.</p>`; }
  }
  function etapasDescHtml(p, ia, fim){
    return `<details class="card pt-etapas" style="margin-top:12px"><summary><h3 style="display:inline">Como funciona cada etapa</h3><span class="sub"> · toque para ver</span></summary>
      <ol>${ETAPAS.map((e, i) => { const st = i < ia || fim ? "done" : i === ia ? "cur" : ""; return `<li class="${st}"><span class="n">${st === "done" ? "✓" : i + 1}</span><div><b>${esc(e)}</b>${st === "cur" ? ` <span class="chip">etapa atual</span>` : ""}<p>${esc(ETAPA_DESC[e] || "")}</p></div></li>`; }).join("")}</ol></details>`;
  }
  function equipeHtml(){
    const eq = dados.equipe || []; if (!eq.length) return "";
    return `<div class="card pt-equipe" style="margin-top:12px"><span class="label">Fale com a gente</span><h3>Equipe Saotech</h3><div class="pt-eqlist">${eq.map(x => { const t = String(x.telefone || "").replace(/\D/g, ""); const w = t ? (t.length <= 11 ? "55" + t : t) : "";
      return `<div class="pt-eq"><span class="av">${esc(String(x.nome || "").split(/\s+/).map(s => s[0]).slice(0, 2).join("").toUpperCase())}</span><div class="grow"><b>${esc(x.nome)}</b><span class="sub">${esc(x.ocupacao || "")}</span>
        <div class="pt-eqacts">${w ? `<a class="btn sm" href="https://wa.me/${w}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${x.email ? `<a class="btn sm ghost" href="mailto:${esc(x.email)}">E-mail</a>` : ""}</div></div></div>`; }).join("")}</div></div>`;
  }
  function docsHtmlAntigo(p){
    const ds = p.docs || [];
    if (!ds.length) return "";
    return `<div class="card" style="margin-top:12px" id="pt-docs"><h3>Documentos para baixar</h3>${ds.slice().reverse().map(d => `<a class="pt-baixar" data-blob="${esc(d.id)}" data-noprev target="_blank" rel="noopener" download="${esc(d.nome)}"><span class="ic-doc">📄</span><span class="grow"><b>${esc(d.rotulo || "Documento")}</b><span class="sub">${esc(d.nome)}${d.tam ? " · " + fTam(d.tam) : ""}${d.em ? " · " + fData(d.em) : ""}</span></span><span class="btn sm">Baixar</span></a>`).join("")}</div>`;
  }
  function avaliacaoHtml(p){
    if (!["Entregue", "Concluída"].includes(p.etapa)) return "";
    const av = (dados.avaliacoes || []).find(a => a.demanda === p.id);
    if (av && avEditar !== p.id) return `<div class="card pt-aval" style="margin-top:12px"><h3>Obrigado pela avaliação!</h3><div class="estrelas">${"★".repeat(av.nota)}<span>${"★".repeat(5 - av.nota)}</span></div>${av.comentario ? `<p>“${esc(av.comentario)}”</p>` : ""}<button type="button" class="btn sm ghost" data-avedit="${esc(p.id)}">Alterar avaliação</button></div>`;
    const nota = avNota || av?.nota || 0;
    return `<form class="card pt-aval" style="margin-top:12px" id="pt-aval" data-dem="${esc(p.id)}"><h3>Como foi o nosso serviço?</h3><p class="sub" style="margin:0 0 8px">Sua opinião ajuda a Saotech a melhorar. Leva menos de um minuto.</p>
      <div class="av-estrelas" role="radiogroup" aria-label="Nota de 1 a 5">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${nota === n}" aria-label="${n} estrela${n > 1 ? "s" : ""}" data-avnota="${n}" class="${n <= nota ? "on" : ""}">★</button>`).join("")}</div>
      <textarea id="av-com" rows="3" placeholder="Conte como foi sua experiência (opcional)">${esc(av?.comentario || "")}</textarea>
      <label class="av-aut"><input type="checkbox" id="av-aut" ${av?.autoriza ? "checked" : ""}> Autorizo a Saotech a publicar meu comentário como depoimento (com meu primeiro nome).</label>
      <div style="display:flex;gap:8px;justify-content:flex-end">${av ? `<button type="button" class="btn sm ghost" data-avcancel>Cancelar</button>` : ""}<button class="btn primary" ${nota ? "" : "disabled"}>Enviar avaliação</button></div></form>`;
  }

  function etapaDatas(p){
    const out = {};
    for (const h of p.etapas || []) {
      if (/^criou a demanda/.test(h.txt)) out["Orçamento"] = out["Orçamento"] || h.em;
      const m = /^moveu de .+ para (.+)$/.exec(h.txt || ""); if (m) out[m[1]] = h.em;
    }
    return out;
  }
  function processoHtml(p){
    const datas = etapaDatas(p);
    let atual = p.etapa;
    if (atual === "Pausada") { const ult = [...(p.etapas || [])].reverse().find(h => / para Pausada$/.test(h.txt)); const m = ult && /^moveu de (.+) para Pausada$/.exec(ult.txt); atual = m ? m[1] : "Orçamento"; }
    const ia = Math.max(0, ETAPAS.indexOf(atual)); const fim = atual === "Concluída";
    const passos = ETAPAS.map((e, i) => { const st = i < ia || fim ? "done" : i === ia ? "cur" : ""; return `<div class="step ${st}"><span class="n">${st === "done" ? "✓" : i + 1}</span><span class="t">${esc(e)}</span>${datas[e] && i <= ia ? `<time>${fDM(datas[e])}</time>` : ""}</div>`; }).join("");
    const cl = p.checklist || []; const ok = cl.filter(i => i.ok).length; const pct = cl.length ? Math.round(ok / cl.length * 100) : 0;
    const docs = cl.filter(i => i.doc && !i.ok);
    const ag = (p.agenda || []).filter(a => (a.prazo || a.data) >= hoje()).sort((a, b) => a.data < b.data ? -1 : 1);
    let explica = EXPLICA[p.etapa] || "";
    if (p.etapa === "Protocolo" && (p.protocoloOrgao || p.protocoloNumero)) explica = `Processo protocolado${p.protocoloOrgao ? " em " + esc(p.protocoloOrgao) : ""}${p.protocoloNumero ? ", nº " + esc(p.protocoloNumero) : ""}${p.protocoloPrevisao ? `. Previsão de retorno: ${fData(p.protocoloPrevisao)}` : ""}. Aguardamos a análise do órgão.`;
    const hist = [...(p.etapas || [])].sort((a, b) => a.em < b.em ? 1 : -1).map(h => { const m = /^moveu de .+ para (.+)$/.exec(h.txt || ""); return `<div class="tl-it k-etapa"><time>${fData(h.em)}</time><div>${m ? `Seu processo avançou para <b>${esc(m[1])}</b>` : "Processo aberto na Saotech"}</div></div>`; }).join("");
    return `<section class="pt-proc">
      <div class="proc-h">${window.__curvas || ""}
        <span class="label">${esc(p.codigo || "")}${(p.servicos || []).length ? " · " + esc(p.servicos.join(" · ")) : ""}</span>
        <h2>${esc(p.cliente || "")}</h2>
        <div class="meta">${p.imovel ? `<span>${esc(p.imovel)}</span>` : ""}${p.municipio ? `<span>${esc(p.municipio)}</span>` : ""}${p.areaHa ? `<span>${String(p.areaHa).replace(".", ",")} ha</span>` : ""}</div>
      </div>
      <div class="card" style="margin-top:12px"><div class="stepper">${passos}</div><p class="pt-explica"><b>${esc(p.etapa)}:</b> ${explica}</p></div>
      ${etapasDescHtml(p, ia, fim)}
      ${p.fin?.proposta?.status === "enviada" ? propostaHtml(p) : ""}
      <div class="pstats">
        <div class="pst"><span class="label">Andamento</span><b>${pct}%</b><div class="prog"><i style="width:${pct}%"></i></div><span class="sub">${ok} de ${cl.length} etapas internas</span></div>
        <div class="pst ${docs.length ? "warn" : ""}"><span class="label">Documentos que precisamos</span><b>${docs.length}</b><span class="sub">${docs.length ? "envie pelo chat ao lado" : "nada pendente com você"}</span></div>
        <div class="pst"><span class="label">Próximo compromisso</span><b>${ag[0] ? fDM(ag[0].data) : "—"}</b><span class="sub">${ag[0] ? esc(ag[0].tipo) + (ag[0].inicio ? " · " + esc(ag[0].inicio) : "") : "nada agendado"}</span></div>
      </div>
      ${docs.length ? `<div class="card" style="margin-top:12px"><h3>Precisamos destes documentos</h3>${docs.map(d => `<div class="pt-doc">📄 ${esc(d.t)}</div>`).join("")}<p class="sub" style="margin:8px 0 0">Envie foto ou PDF pelo chat (botão 📎).</p></div>` : ""}
      ${ag.length ? `<div class="card" style="margin-top:12px"><h3>Agenda</h3>${ag.map(a => `<div class="pt-doc">📅 <b>${fData(a.data)}${a.prazo && a.prazo > a.data ? " a " + fData(a.prazo) : ""}</b>${a.inicio ? " · " + esc(a.inicio) : ""} · ${esc(a.tipo || "")}</div>`).join("")}</div>` : ""}
      ${p.fin?.proposta?.status !== "enviada" ? propostaHtml(p) : ""}
      ${avaliacaoHtml(p)}
      ${docsHtml(p)}
      ${imovelHtml(p)}
      ${pagamentosHtml(p)}
      ${hist ? `<div class="card" style="margin-top:12px"><h3>Histórico do processo</h3><div class="tl">${hist}</div></div>` : ""}
    </section>`;
  }
  function anexosHtml(an){
    if (!an || !an.length) return "";
    return `<div class="atts">${an.map(a => /^image\//.test(a.tipo || "")
      ? `<a class="img" data-blob="${esc(a.id)}" data-noprev target="_blank" rel="noopener" title="${esc(a.nome)}"><img data-blob="${esc(a.id)}" alt="${esc(a.nome)}"></a>`
      : `<a class="file" data-blob="${esc(a.id)}" data-noprev target="_blank" rel="noopener">📄 <span>${esc(a.nome)}</span></a>`).join("")}</div>`;
  }
  function chatHtml(msgs, ags){
    const ult = ultimasPorAg(msgs); let dia = "", h = "";
    for (const m of msgs) {
      const d = new Date(m.em).toLocaleDateString("sv-SE");
      if (d !== dia) { dia = d; h += `<div class="chat-day">${esc(fDia(m.em))}</div>`; }
      const meu = m.de === "cliente";
      const nome = meu ? "Você" : "Equipe Saotech · " + (EQUIPE[m.de] || "").split(" ")[0];
      if (m.tipo === "agendamento") {
        const ag = (ags || []).find(a => a.id === m.ag);
        h += `<div class="ag-ev"><span>${esc(meu ? "Você" : quem(m.de))} · ${fHora(m.em)}</span> ${esc(m.texto)}</div>`;
        if (ag && ult[ag.id] === m.id) h += cardHtml(ag, "cliente");
        continue;
      }
      h += `<div class="msg ${meu ? "me" : ""}"><span class="av">${meu ? "EU" : "ST"}</span><div class="bubble"><div class="h"><b>${esc(nome)}</b><span>${fHora(m.em)}</span></div>${m.texto ? `<div class="tx">${esc(m.texto)}</div>` : ""}${anexosHtml(m.anexos)}</div></div>`;
    }
    return h || `<p class="muted" style="text-align:center">Mande sua dúvida, envie documentos ou solicite um agendamento.</p>`;
  }
  function render(){
    const el = document.getElementById("portal"); if (!el || !dados) return;
    const rasc = el.querySelector("#pt-txt")?.value || "";
    const avTxt = el.querySelector("#av-com")?.value, avAut = el.querySelector("#av-aut")?.checked;
    const formVals = form ? Object.fromEntries(new FormData(el.querySelector(".ag-form") || document.createElement("form"))) : null;
    const chat = el.querySelector("#pt-chat"); const noFim = !chat || chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60;
    const primeiro = (dados.nome || "").split(/\s+/)[0];
    const visorAnt = el.querySelector(".pt-vb"); const mapaAnt = el.querySelector("[data-ptmapa][data-ok]");
    const procs = dados.processos || [];
    const agAtual = form && form.id ? (dados.agendamentos || []).find(a => a.id === form.id) : null;
    el.innerHTML = `
      <header class="top pt-top">
        <div class="brand">${window.__logo ? `<img src="${window.__logo}" alt="Saotech Geotecnologia">` : "<b>SAOTECH</b>"}<h1>Portal do cliente</h1><p>${saud()}, ${esc(primeiro)} · ${new Date().toLocaleDateString("pt-BR", {weekday: "long", day: "numeric", month: "long"})}</p></div>
        <div class="hdr-acts">${pushEst === "inativo" || pushEst === "ios-instalar" ? `<button type="button" class="btn sm lima" id="pt-push">🔔 Receber avisos</button>` : pushEst === "ativo" ? `<span class="sub pt-push-ok" title="Você recebe avisos neste aparelho">🔔 avisos ativos</span>` : ""}<button type="button" class="btn sm ghost" id="pt-sair">Sair</button></div>
      </header>
      ${procs.length > 1 ? `<nav class="tabs" role="tablist">${procs.map((p, i) => `<button role="tab" aria-selected="${(window.__ptSel || 0) === i}" data-ptsel="${i}">${esc(p.codigo)} · ${esc((p.servicos || [])[0] || p.cliente)}</button>`).join("")}</nav>` : ""}
      <main class="pt-grid">
        <div>${procs.length ? processoHtml(procs[Math.min(window.__ptSel || 0, procs.length - 1)]) : `<div class="card empty">Nenhum processo vinculado ao seu acesso ainda.</div>`}</div>
        <aside class="card chatbox pt-chatbox"><div class="conv-h"><div><span class="label">Conversa exclusiva</span><h3>Você e a equipe Saotech</h3></div><button type="button" class="btn sm lima" id="pt-agendar">📅 Agendar</button></div>
          <div class="chat" id="pt-chat">${chatHtml(dados.msgs || [], dados.agendamentos || [])}</div>
          ${form ? `<div class="ag-wrap">${erroForm ? `<p class="ag-erro">${esc(erroForm)}</p>` : ""}${formHtml(form.modo, agAtual, procs.map(p => ({id: p.id, codigo: p.codigo, rotulo: (p.servicos || [])[0] || p.cliente})))}</div>` : ""}
          <form class="composer" id="pt-form"><textarea id="pt-txt" rows="2" placeholder="Escreva sua mensagem">${esc(rasc)}</textarea>
            <div class="row2"><label class="filebtn">📎 Foto ou documento<input type="file" id="pt-file" multiple accept="image/*,application/pdf"></label><span class="pend sub" id="pt-pend"></span><button class="btn primary" style="margin-left:auto" ${enviando ? "disabled" : ""}>Enviar</button></div></form>
        </aside>
      </main>
      ${equipeHtml()}
      <p class="sub pt-rodape">Saotech Geotecnologia · Este acesso mostra apenas os seus processos.</p>
      ${ptDoc && procs.length ? visorHtml(procs[Math.min(window.__ptSel || 0, procs.length - 1)]) : ""}`;
    document.body.classList.toggle("pt-visor-on", !!el.querySelector(".pt-visor"));
    const vb = el.querySelector(".pt-vb");
    if (vb) { if (visorAnt && visorAnt.dataset.id === vb.dataset.id) vb.replaceWith(visorAnt); else { const p = procs[Math.min(window.__ptSel || 0, procs.length - 1)]; visorConteudo(vb, (p.docs || []).find(x => x.id === vb.dataset.id)); } }
    const mp = el.querySelector("[data-ptmapa]");
    if (mp && mapaAnt && mapaAnt.dataset.ptmapa === mp.dataset.ptmapa) { mp.replaceWith(mapaAnt); setTimeout(() => mapaAnt.__mapa?.invalidateSize(), 50); } else desenharMapas(el);
    el.querySelectorAll("img[data-ptth]").forEach(img => window.SaotechPdf.miniatura(img.dataset.ptth, obterArq(img.dataset.ptth)).then(u => { if (u) img.src = u; }));
    if (formVals) { const f = el.querySelector(".ag-form"); if (f) for (const [k, v] of Object.entries(formVals)) { const inp = f.elements[k]; if (!inp) continue; if (inp instanceof RadioNodeList) { [...inp].forEach(r => r.checked = r.value === v); } else inp.value = v; } }
    const c = el.querySelector("#pt-chat"); if (c && noFim) c.scrollTop = c.scrollHeight;
    if (el.querySelector("[data-pixqr]")) window.SaotechPix.preencherQR(el);
    if (avTxt !== undefined && el.querySelector("#av-com")) { el.querySelector("#av-com").value = avTxt; el.querySelector("#av-aut").checked = !!avAut; }
  }
  async function atualizar(){
    if (form) return; // não interrompe quem está preenchendo o agendamento
    if (document.activeElement?.id === "av-com" || propForm || pixAberto || ptDoc || ptBaixando) return;
    try { const {data, error} = await sb.rpc("portal_dados"); if (!error && data) { const antes = JSON.stringify(dados); dados = data; if (JSON.stringify(dados) !== antes) render(); } } catch {}
  }
  async function enviarArquivos(files){
    const out = []; const pend = document.getElementById("pt-pend");
    for (const [i, f0] of [...files].entries()) {
      if (pend) pend.textContent = `Enviando ${i + 1} de ${files.length}…`;
      const f = await prepararImagem(f0);
      if (f.size > 20 * 1024 * 1024) { alert(`${f0.name}: arquivo maior que 20 MB`); continue; }
      const nome = (f.name || "arquivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
      const id = `portal/${dados.usuario}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}-${nome}`;
      const {error} = await sb.storage.from("anexos").upload(id, f, {contentType: f.type || "application/octet-stream", upsert: false});
      if (error) { alert(`${f0.name}: não foi possível enviar`); continue; }
      out.push({id, nome: f0.name, tipo: f.type || ""});
    }
    if (pend) pend.textContent = "";
    return out;
  }
  async function atualizarJa(){ try { const {data} = await sb.rpc("portal_dados"); if (data) { dados = data; render(); } } catch {} }
  function iniciar(cliente, inicial){
    sb = cliente; dados = inicial;
    window.SaotechPush.estado().then(e => { pushEst = e; render(); });
    window.SaotechPush.renovar(sub => sb.rpc("salvar_push", {p_sub: sub, p_ua: navigator.userAgent}));
    navigator.serviceWorker?.addEventListener("message", e => { if (e.data?.tipo === "abrir") atualizarJa(); });
    window.__logo = document.querySelector(".brand img")?.src || "";
    try { window.__curvas = typeof curvasSVG === "function" ? curvasSVG() : ""; } catch { window.__curvas = ""; }
    let el = document.getElementById("portal");
    if (!el) { el = document.createElement("div"); el.id = "portal"; el.className = "wrap portal"; document.body.appendChild(el); }
    render();
    el.addEventListener("click", async e => {
      if (e.target.id === "pt-sair") { await sb.auth.signOut(); location.reload(); return; }
      if (e.target.closest("#pt-push")) {
        if (pushEst === "ios-instalar") { alert("No iPhone: toque em Compartilhar (quadrado com seta) → Adicionar à Tela de Início. Depois abra o portal pelo ícone e toque em Receber avisos."); return; }
        try { await window.SaotechPush.ativar(sub => sb.rpc("salvar_push", {p_sub: sub, p_ua: navigator.userAgent}).then(r => { if (r.error) throw r.error; })); pushEst = "ativo"; render(); alert("Pronto! Você vai receber um aviso quando a equipe responder, agendar ou seu processo avançar."); }
        catch (err) { alert(/bloqueado/.test(err.message || "") ? "As notificações estão bloqueadas neste navegador. Libere nas configurações do site e tente de novo." : "Não foi possível ativar: " + (err.message || err)); }
        return;
      }
      const pa = e.target.closest("[data-propacao]"); if (pa) { propForm = pa.dataset.propacao; render(); el.querySelector(".pt-aceite input, .pt-aceite textarea")?.focus(); return; }
      if (e.target.closest("[data-propcancel]")) { propForm = null; render(); return; }
      const pp = e.target.closest("[data-proppdf]"); if (pp) { const pr = (dados.processos || []).find(x => x.id === pp.dataset.proppdf); if (pr?.fin?.proposta) window.SaotechDoc.imprimir("Proposta " + pr.fin.proposta.numero, window.SaotechDoc.propostaHtml(pr.fin.proposta, pr, window.__logo)); return; }
      const px = e.target.closest("[data-ptpix]"); if (px) { pixAberto = pixAberto === px.dataset.ptpix ? null : px.dataset.ptpix; render(); return; }
      const cp = e.target.closest("[data-copiapix]"); if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copiapix); cp.textContent = "Copiado ✓"; } catch { cp.previousElementSibling?.querySelector("textarea")?.select(); } return; }
      const an = e.target.closest("[data-avnota]"); if (an) { avNota = +an.dataset.avnota; render(); return; }
      const ae = e.target.closest("[data-avedit]"); if (ae) { avEditar = ae.dataset.avedit; avNota = 0; render(); return; }
      if (e.target.closest("[data-avcancel]")) { avEditar = null; avNota = 0; render(); return; }
      const t = e.target.closest("[data-ptsel]"); if (t) { window.__ptSel = +t.dataset.ptsel; ptDoc = null; ptSel.clear(); render(); return; }
      const pv = e.target.closest("[data-ptver]"); if (pv) { ptDoc = pv.dataset.ptver; render(); el.querySelector(".pt-visor")?.scrollTo(0, 0); return; }
      if (e.target.closest("[data-ptvoltar]")) { ptDoc = null; render(); document.getElementById("pt-docs")?.scrollIntoView({block: "start"}); return; }
      const pb = e.target.closest("[data-ptbaixa]"); if (pb) { const p = (dados.processos || [])[Math.min(window.__ptSel || 0, (dados.processos || []).length - 1)]; const d = (p?.docs || []).find(x => x.id === pb.dataset.ptbaixa); if (d) { pb.disabled = true; try { baixarBlob(await obterArq(d.id)(), d.nome); } catch { alert("Não foi possível baixar agora. Tente de novo."); } pb.disabled = false; } return; }
      const pz = e.target.closest("[data-ptzip]"); if (pz) { const p = (dados.processos || [])[Math.min(window.__ptSel || 0, (dados.processos || []).length - 1)]; const ds = (p?.docs || []).filter(d => pz.dataset.ptzip === "tudo" || ptSel.has(d.id)); if (ds.length) { pz.disabled = true; await baixarDocs(ds, `documentos-${String(p.codigo || "saotech").toLowerCase()}`); } return; }
      if (e.target.closest("#pt-agendar")) { form = {modo: "novo"}; erroForm = ""; render(); el.querySelector(".ag-form")?.scrollIntoView({behavior: "smooth", block: "center"}); return; }
      if (e.target.closest("[data-agfechar]")) { form = null; erroForm = ""; render(); return; }
      const ac = e.target.closest("[data-agacao]");
      if (ac) {
        const acao = ac.dataset.agacao, id = ac.dataset.agid;
        if (acao === "confirmar") { ac.disabled = true; const {error} = await sb.rpc("portal_agendar", {p_usuario: null, p_acao: "confirmar", p_ag: {id}}); if (error) alert(error.message); form = null; await atualizar(); return; }
        form = {modo: acao, id}; erroForm = ""; render(); el.querySelector(".ag-form")?.scrollIntoView({behavior: "smooth", block: "center"});
      }
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && ptDoc) { ptDoc = null; render(); } });
    el.addEventListener("change", e => { const sc = e.target.closest("[data-ptsel2]"); if (sc) { sc.checked ? ptSel.add(sc.dataset.ptsel2) : ptSel.delete(sc.dataset.ptsel2); render(); return; } if (e.target.id === "pt-file") { const p = document.getElementById("pt-pend"); if (p) p.textContent = e.target.files.length ? `${e.target.files.length} arquivo(s) selecionado(s)` : ""; } });
    el.addEventListener("submit", async e => {
      const f = e.target.closest(".ag-form");
      if (f) {
        e.preventDefault(); const r = lerForm(f); if (r.erro) { erroForm = r.erro; render(); return; }
        f.querySelector(".btn.primary, .btn.danger").disabled = true;
        const {error} = await sb.rpc("portal_agendar", {p_usuario: null, p_acao: r.acao, p_ag: r.ag});
        if (error) { erroForm = error.message; render(); return; }
        form = null; erroForm = ""; await atualizar(); return;
      }
      const fa = e.target.closest("[data-propaceite], [data-propajuste]");
      if (fa) {
        e.preventDefault(); const aceitar = fa.hasAttribute("data-propaceite"); const dem = fa.dataset.propaceite || fa.dataset.propajuste;
        fa.querySelector(".btn.primary").disabled = true;
        const {error} = await sb.rpc("portal_proposta", {p_demanda: dem, p_acao: aceitar ? "aceitar" : "recusar", p_nome: aceitar ? fa.elements.nome.value : null, p_motivo: aceitar ? null : fa.elements.motivo.value});
        if (error) { alert(error.message); fa.querySelector(".btn.primary").disabled = false; return; }
        propForm = null; await atualizarJa();
        if (aceitar) alert("Proposta aceita! A equipe Saotech já foi avisada e vai combinar os próximos passos com você.");
        return;
      }
      if (e.target.id === "pt-aval") {
        e.preventDefault();
        const dem = e.target.dataset.dem; const av = (dados.avaliacoes || []).find(a => a.demanda === dem);
        const nota = avNota || av?.nota || 0; if (!nota) return;
        e.target.querySelector(".btn.primary").disabled = true;
        const {error} = await sb.rpc("portal_avaliar", {p_demanda: dem, p_nota: nota, p_comentario: el.querySelector("#av-com").value, p_autoriza: el.querySelector("#av-aut").checked});
        if (error) { alert("Não foi possível enviar: " + error.message); render(); return; }
        avEditar = null; avNota = 0; el.querySelector("#av-com").value = ""; await atualizarJa(); return;
      }
      if (e.target.id !== "pt-form") return; e.preventDefault();
      const txt = el.querySelector("#pt-txt"); const fileEl = el.querySelector("#pt-file"); const texto = txt.value.trim(); const files = fileEl?.files || [];
      if ((!texto && !files.length) || enviando) return;
      enviando = true; const btn = e.target.querySelector(".btn.primary"); btn.disabled = true;
      const anexos = files.length ? await enviarArquivos(files) : [];
      if (!texto && !anexos.length) { enviando = false; btn.disabled = false; return; }
      txt.value = "";
      const {data, error} = await sb.rpc("portal_mensagem", {p_texto: texto, p_anexos: anexos});
      enviando = false;
      if (error) { txt.value = texto; alert("Não foi possível enviar agora. Tente de novo."); render(); return; }
      dados.msgs = [...(dados.msgs || []), data]; render();
    });
    el.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && e.target.id === "pt-txt" && window.matchMedia("(pointer:fine)").matches) { e.preventDefault(); el.querySelector("#pt-form").requestSubmit(); } });
    clearInterval(timer); timer = setInterval(atualizar, 15000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizar(); });
  }
  window.SaotechPortal = {iniciar};
})();
