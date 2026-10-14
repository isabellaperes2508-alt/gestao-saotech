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

  /* ================= Portal do cliente ================= */
  const ETAPAS = ["Orçamento", "Aguardando entrada", "Campo", "Escritório", "Protocolo", "Entregue", "Concluída"];
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
  let sb = null, dados = null, timer = null, enviando = false, form = null, erroForm = "";

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
      <div class="pstats">
        <div class="pst"><span class="label">Andamento</span><b>${pct}%</b><div class="prog"><i style="width:${pct}%"></i></div><span class="sub">${ok} de ${cl.length} etapas internas</span></div>
        <div class="pst ${docs.length ? "warn" : ""}"><span class="label">Documentos que precisamos</span><b>${docs.length}</b><span class="sub">${docs.length ? "envie pelo chat ao lado" : "nada pendente com você"}</span></div>
        <div class="pst"><span class="label">Próximo compromisso</span><b>${ag[0] ? fDM(ag[0].data) : "—"}</b><span class="sub">${ag[0] ? esc(ag[0].tipo) + (ag[0].inicio ? " · " + esc(ag[0].inicio) : "") : "nada agendado"}</span></div>
      </div>
      ${docs.length ? `<div class="card" style="margin-top:12px"><h3>Precisamos destes documentos</h3>${docs.map(d => `<div class="pt-doc">📄 ${esc(d.t)}</div>`).join("")}<p class="sub" style="margin:8px 0 0">Envie foto ou PDF pelo chat (botão 📎).</p></div>` : ""}
      ${ag.length ? `<div class="card" style="margin-top:12px"><h3>Agenda</h3>${ag.map(a => `<div class="pt-doc">📅 <b>${fData(a.data)}${a.prazo && a.prazo > a.data ? " a " + fData(a.prazo) : ""}</b>${a.inicio ? " · " + esc(a.inicio) : ""} · ${esc(a.tipo || "")}</div>`).join("")}</div>` : ""}
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
    const formVals = form ? Object.fromEntries(new FormData(el.querySelector(".ag-form") || document.createElement("form"))) : null;
    const chat = el.querySelector("#pt-chat"); const noFim = !chat || chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60;
    const primeiro = (dados.nome || "").split(/\s+/)[0];
    const procs = dados.processos || [];
    const agAtual = form && form.id ? (dados.agendamentos || []).find(a => a.id === form.id) : null;
    el.innerHTML = `
      <header class="top pt-top">
        <div class="brand">${window.__logo ? `<img src="${window.__logo}" alt="Saotech Geotecnologia">` : "<b>SAOTECH</b>"}<h1>Portal do cliente</h1><p>${saud()}, ${esc(primeiro)} · ${new Date().toLocaleDateString("pt-BR", {weekday: "long", day: "numeric", month: "long"})}</p></div>
        <div class="hdr-acts"><button type="button" class="btn sm ghost" id="pt-sair">Sair</button></div>
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
      <p class="sub pt-rodape">Saotech Geotecnologia · Este acesso mostra apenas os seus processos.</p>`;
    if (formVals) { const f = el.querySelector(".ag-form"); if (f) for (const [k, v] of Object.entries(formVals)) { const inp = f.elements[k]; if (!inp) continue; if (inp instanceof RadioNodeList) { [...inp].forEach(r => r.checked = r.value === v); } else inp.value = v; } }
    const c = el.querySelector("#pt-chat"); if (c && noFim) c.scrollTop = c.scrollHeight;
  }
  async function atualizar(){
    if (form) return; // não interrompe quem está preenchendo o agendamento
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
  function iniciar(cliente, inicial){
    sb = cliente; dados = inicial;
    window.__logo = document.querySelector(".brand img")?.src || "";
    try { window.__curvas = typeof curvasSVG === "function" ? curvasSVG() : ""; } catch { window.__curvas = ""; }
    let el = document.getElementById("portal");
    if (!el) { el = document.createElement("div"); el.id = "portal"; el.className = "wrap portal"; document.body.appendChild(el); }
    render();
    el.addEventListener("click", async e => {
      if (e.target.id === "pt-sair") { await sb.auth.signOut(); location.reload(); return; }
      const t = e.target.closest("[data-ptsel]"); if (t) { window.__ptSel = +t.dataset.ptsel; render(); return; }
      if (e.target.closest("#pt-agendar")) { form = {modo: "novo"}; erroForm = ""; render(); el.querySelector(".ag-form")?.scrollIntoView({behavior: "smooth", block: "center"}); return; }
      if (e.target.closest("[data-agfechar]")) { form = null; erroForm = ""; render(); return; }
      const ac = e.target.closest("[data-agacao]");
      if (ac) {
        const acao = ac.dataset.agacao, id = ac.dataset.agid;
        if (acao === "confirmar") { ac.disabled = true; const {error} = await sb.rpc("portal_agendar", {p_usuario: null, p_acao: "confirmar", p_ag: {id}}); if (error) alert(error.message); form = null; await atualizar(); return; }
        form = {modo: acao, id}; erroForm = ""; render(); el.querySelector(".ag-form")?.scrollIntoView({behavior: "smooth", block: "center"});
      }
    });
    el.addEventListener("change", e => { if (e.target.id === "pt-file") { const p = document.getElementById("pt-pend"); if (p) p.textContent = e.target.files.length ? `${e.target.files.length} arquivo(s) selecionado(s)` : ""; } });
    el.addEventListener("submit", async e => {
      const f = e.target.closest(".ag-form");
      if (f) {
        e.preventDefault(); const r = lerForm(f); if (r.erro) { erroForm = r.erro; render(); return; }
        f.querySelector(".btn.primary, .btn.danger").disabled = true;
        const {error} = await sb.rpc("portal_agendar", {p_usuario: null, p_acao: r.acao, p_ag: r.ag});
        if (error) { erroForm = error.message; render(); return; }
        form = null; erroForm = ""; await atualizar(); return;
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
