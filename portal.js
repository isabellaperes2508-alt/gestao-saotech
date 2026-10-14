/* Gestão Saotech — portal do cliente
   O cliente vê apenas os próprios processos (etapa, andamento, documentos pendentes, agenda)
   e conversa com a equipe. Os dados chegam por funções do servidor que filtram tudo pelo login. */
(function () {
  "use strict";
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
  const EQUIPE = {"moises-bruno": "Moisés Bruno", "joao-marcos": "João Marcos", "moises-junior": "Moisés Júnior", "isabella-cleto": "Isabella Cleto"};
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const hoje = () => new Date().toLocaleDateString("sv-SE");
  const fData = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", {day: "2-digit", month: "2-digit", year: "numeric"}) : "";
  const fDM = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", {day: "2-digit", month: "2-digit"}) : "";
  const fHora = ts => new Date(ts).toLocaleTimeString("pt-BR", {hour: "2-digit", minute: "2-digit"});
  const fDia = ts => { const d = new Date(ts).toLocaleDateString("sv-SE"); return d === hoje() ? "Hoje" : new Date(ts).toLocaleDateString("pt-BR", {weekday: "long", day: "2-digit", month: "short"}); };
  const saud = () => { const h = new Date().getHours(); return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };
  let sb = null, dados = null, timer = null, enviando = false;

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
        <div class="pst ${docs.length ? "warn" : ""}"><span class="label">Documentos que precisamos</span><b>${docs.length}</b><span class="sub">${docs.length ? "veja a lista abaixo" : "nada pendente com você"}</span></div>
        <div class="pst"><span class="label">Próximo compromisso</span><b>${ag[0] ? fDM(ag[0].data) : "—"}</b><span class="sub">${ag[0] ? esc(ag[0].tipo) + (ag[0].inicio ? " · " + esc(ag[0].inicio) : "") : "nada agendado"}</span></div>
      </div>
      ${docs.length ? `<div class="card" style="margin-top:12px"><h3>Precisamos destes documentos</h3>${docs.map(d => `<div class="pt-doc">📄 ${esc(d.t)}</div>`).join("")}<p class="sub" style="margin:8px 0 0">Envie foto ou PDF pelo WhatsApp da Saotech ou avise pelo chat abaixo.</p></div>` : ""}
      ${ag.length ? `<div class="card" style="margin-top:12px"><h3>Agenda</h3>${ag.map(a => `<div class="pt-doc">📅 <b>${fData(a.data)}${a.prazo && a.prazo > a.data ? " a " + fData(a.prazo) : ""}</b>${a.inicio ? " · " + esc(a.inicio) : ""} · ${esc(a.tipo || "")}</div>`).join("")}</div>` : ""}
      ${hist ? `<div class="card" style="margin-top:12px"><h3>Histórico do processo</h3><div class="tl">${hist}</div></div>` : ""}
    </section>`;
  }
  function chatHtml(msgs){
    let dia = "", h = "";
    for (const m of msgs) {
      const d = new Date(m.em).toLocaleDateString("sv-SE");
      if (d !== dia) { dia = d; h += `<div class="chat-day">${esc(fDia(m.em))}</div>`; }
      const meu = m.de === "cliente";
      const nome = meu ? "Você" : "Equipe Saotech · " + (EQUIPE[m.de] || "").split(" ")[0];
      h += `<div class="msg ${meu ? "me" : ""}"><span class="av">${meu ? "EU" : "ST"}</span><div class="bubble"><div class="h"><b>${esc(nome)}</b><span>${fHora(m.em)}</span></div><div class="tx">${esc(m.texto)}</div></div></div>`;
    }
    return h || `<p class="muted" style="text-align:center">Mande sua dúvida, peça um horário ou envie um recado para a equipe.</p>`;
  }
  function render(){
    const el = document.getElementById("portal"); if (!el || !dados) return;
    const rasc = el.querySelector("#pt-txt")?.value || "";
    const chat = el.querySelector("#pt-chat"); const noFim = !chat || chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60;
    const primeiro = (dados.nome || "").split(/\s+/)[0];
    const procs = dados.processos || [];
    el.innerHTML = `
      <header class="top pt-top">
        <div class="brand">${window.__logo ? `<img src="${window.__logo}" alt="Saotech Geotecnologia">` : "<b>SAOTECH</b>"}<h1>Portal do cliente</h1><p>${saud()}, ${esc(primeiro)} · ${new Date().toLocaleDateString("pt-BR", {weekday: "long", day: "numeric", month: "long"})}</p></div>
        <div class="hdr-acts"><button type="button" class="btn sm ghost" id="pt-sair">Sair</button></div>
      </header>
      ${procs.length > 1 ? `<nav class="tabs" role="tablist">${procs.map((p, i) => `<button role="tab" aria-selected="${(window.__ptSel || 0) === i}" data-ptsel="${i}">${esc(p.codigo)} · ${esc((p.servicos || [])[0] || p.cliente)}</button>`).join("")}</nav>` : ""}
      <main class="pt-grid">
        <div>${procs.length ? processoHtml(procs[Math.min(window.__ptSel || 0, procs.length - 1)]) : `<div class="card empty">Nenhum processo vinculado ao seu acesso ainda.</div>`}</div>
        <aside class="card chatbox pt-chatbox"><div class="conv-h"><div><span class="label">Conversa exclusiva</span><h3>Você e a equipe Saotech</h3></div></div>
          <div class="chat" id="pt-chat">${chatHtml(dados.msgs || [])}</div>
          <form class="composer" id="pt-form"><textarea id="pt-txt" rows="2" placeholder="Escreva sua mensagem (ex.: gostaria de agendar uma visita)">${esc(rasc)}</textarea>
            <div class="row2"><span class="pend sub">A equipe responde em horário comercial.</span><button class="btn primary" style="margin-left:auto" ${enviando ? "disabled" : ""}>Enviar</button></div></form>
        </aside>
      </main>
      <p class="sub pt-rodape">Saotech Geotecnologia · Este acesso mostra apenas os seus processos.</p>`;
    const c = el.querySelector("#pt-chat"); if (c && noFim) c.scrollTop = c.scrollHeight;
  }
  async function atualizar(){
    try { const {data, error} = await sb.rpc("portal_dados"); if (!error && data) { const antes = JSON.stringify(dados); dados = data; if (JSON.stringify(dados) !== antes) render(); } } catch {}
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
      const t = e.target.closest("[data-ptsel]"); if (t) { window.__ptSel = +t.dataset.ptsel; render(); }
    });
    el.addEventListener("submit", async e => {
      if (e.target.id !== "pt-form") return; e.preventDefault();
      const txt = el.querySelector("#pt-txt"); const texto = txt.value.trim(); if (!texto || enviando) return;
      enviando = true; txt.value = "";
      const {data, error} = await sb.rpc("portal_enviar", {p_texto: texto});
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
