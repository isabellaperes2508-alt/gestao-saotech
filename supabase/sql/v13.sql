-- v13: Google Agenda (ICS), proposta com aceite, Pix no portal, automações por etapa

-- ---------- Google Agenda: link de assinatura por pessoa ----------
create table if not exists public.agenda_links (
  token text primary key,
  email text unique not null,
  criado_em timestamptz not null default now()
);
alter table public.agenda_links enable row level security;

create or replace function public.link_agenda(p_novo boolean default false) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email','')); v_tok text;
begin
  if not public.e_membro() then raise exception 'sem acesso'; end if;
  select token into v_tok from public.agenda_links where email = v_email;
  if v_tok is null or p_novo then
    v_tok := encode(extensions.gen_random_bytes(18), 'hex');
    insert into public.agenda_links(token, email) values (v_tok, v_email)
    on conflict (email) do update set token = excluded.token, criado_em = now();
  end if;
  return v_tok;
end $$;

create or replace function public.ics_txt(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t,''), '\', '\\'), ';', '\;'), ',', '\,'), E'\n', '\n');
$$;

create or replace function public.agenda_ics(p_token text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_pessoa text; v_email text; r record; out text; ini timestamp; fim timestamp; utc text := 'YYYYMMDD"T"HH24MISS"Z"'; agora text;
begin
  select l.email into v_email from public.agenda_links l where l.token = p_token;
  if v_email is null then return null; end if;
  select pessoa into v_pessoa from public.equipe where email = v_email;
  agora := to_char(now() at time zone 'utc', utc);
  out := E'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Saotech Geotecnologia//Gestao Saotech//PT\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Saotech · ' || public.ics_txt(public.nome_pessoa(v_pessoa)) || E'\r\nX-WR-TIMEZONE:America/Sao_Paulo\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\nX-PUBLISHED-TTL:PT1H\r\n';
  for r in
    select a.path, a.data d, dm.data dem from public.docs a
    left join public.docs dm on dm.path = 'demandas/' || nullif(a.data->>'demandaId','')
    where a.col = 'agenda' and coalesce(a.data->>'exemplo','') <> 'true'
      and (a.data->'pessoas') ? v_pessoa
      and coalesce(a.data->>'prazo', a.data->>'data', '') >= to_char(now() - interval '90 days', 'YYYY-MM-DD')
      and coalesce(a.data->>'data','') ~ '^\d{4}-\d{2}-\d{2}$'
  loop
    out := out || E'BEGIN:VEVENT\r\nUID:' || replace(r.path, '/', '-') || E'@saotech\r\nDTSTAMP:' || agora || E'\r\n';
    if coalesce(r.d->>'inicio','') ~ '^\d{1,2}:\d{2}$' and coalesce(r.d->>'prazo', r.d->>'data') <= r.d->>'data' then
      ini := ((r.d->>'data') || ' ' || (r.d->>'inicio'))::timestamp;
      fim := case when coalesce(r.d->>'fim','') ~ '^\d{1,2}:\d{2}$' then ((r.d->>'data') || ' ' || (r.d->>'fim'))::timestamp
                  when r.d->>'tipo' ilike '%reuni%' then ini + interval '1 hour' else ini + interval '2 hours' end;
      out := out || 'DTSTART:' || to_char((ini at time zone 'America/Sao_Paulo') at time zone 'utc', utc) || E'\r\nDTEND:' || to_char((fim at time zone 'America/Sao_Paulo') at time zone 'utc', utc) || E'\r\n';
    else
      out := out || 'DTSTART;VALUE=DATE:' || replace(r.d->>'data', '-', '') || E'\r\nDTEND;VALUE=DATE:'
        || to_char(greatest((r.d->>'data')::date, coalesce(nullif(r.d->>'prazo','')::date, (r.d->>'data')::date)) + 1, 'YYYYMMDD') || E'\r\n';
    end if;
    out := out || 'SUMMARY:' || public.ics_txt(coalesce(nullif(r.d->>'titulo',''), r.d->>'tipo', 'Compromisso')
             || case when r.dem is not null then ' · ' || split_part(r.dem->>'cliente', ' — ', 1) else '' end) || E'\r\n';
    if coalesce(r.d->>'local','') <> '' then out := out || 'LOCATION:' || public.ics_txt(r.d->>'local') || E'\r\n'; end if;
    out := out || 'DESCRIPTION:' || public.ics_txt(concat_ws(E'\n',
        coalesce(r.d->>'tipo',''),
        case when r.dem is not null then (r.dem->>'codigo') || ' · ' || (r.dem->>'cliente') end,
        case when coalesce(r.dem->>'contato','') <> '' then 'Contato: ' || (r.dem->>'contato') end,
        nullif(r.d->>'obs',''),
        'Pessoas: ' || (select string_agg(public.nome_pessoa(p), ', ') from jsonb_array_elements_text(r.d->'pessoas') p))) || E'\r\n';
    if (r.dem->'geo'->>'lat') is not null then out := out || 'GEO:' || (r.dem->'geo'->>'lat') || ';' || (r.dem->'geo'->>'lng') || E'\r\n'; end if;
    out := out || E'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Lembrete\r\nTRIGGER:-PT1H\r\nEND:VALARM\r\nEND:VEVENT\r\n';
  end loop;
  -- prazos das demandas sob responsabilidade da pessoa
  for r in
    select d.path, d.data from public.docs d
    where d.col = 'demandas' and coalesce(d.data->>'exemplo','') <> 'true' and d.data->>'responsavel' = v_pessoa
      and coalesce(d.data->>'prazo','') ~ '^\d{4}-\d{2}-\d{2}$'
      and d.data->>'etapa' in ('Orçamento','Aguardando entrada','Campo','Escritório','Protocolo','Entregue')
  loop
    out := out || E'BEGIN:VEVENT\r\nUID:prazo-' || split_part(r.path, '/', 2) || E'@saotech\r\nDTSTAMP:' || agora
      || E'\r\nDTSTART;VALUE=DATE:' || replace(r.data->>'prazo', '-', '') || E'\r\nDTEND;VALUE=DATE:' || to_char((r.data->>'prazo')::date + 1, 'YYYYMMDD')
      || E'\r\nSUMMARY:' || public.ics_txt('Prazo · ' || (r.data->>'codigo') || ' · ' || split_part(r.data->>'cliente', ' — ', 1))
      || E'\r\nDESCRIPTION:' || public.ics_txt('Etapa atual: ' || (r.data->>'etapa') || E'\n' || (r.data->>'cliente'))
      || E'\r\nTRANSP:TRANSPARENT\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Prazo amanhã\r\nTRIGGER:-PT15H\r\nEND:VALARM\r\nEND:VEVENT\r\n';
  end loop;
  return out || E'END:VCALENDAR\r\n';
end $$;
revoke execute on function public.agenda_ics(text) from public;
grant execute on function public.agenda_ics(text) to anon, authenticated;
revoke execute on function public.link_agenda(boolean) from public, anon;
grant execute on function public.link_agenda(boolean) to authenticated;

-- ---------- Portal: proposta, parcelas e Pix ----------
create or replace function public.portal_fin(p_dem text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'proposta', case when f.data->'proposta'->>'status' in ('enviada','aceita','recusada') then
        (f.data->'proposta') - 'notasInternas' - 'log' end,
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('id', p->'id', 'rotulo', p->'rotulo', 'valor', coalesce(p->'pago'->'valor', p->'valor'),
        'vencimento', p->'vencimento', 'pago', (p->'pago') is not null and jsonb_typeof(p->'pago') = 'object', 'pagoEm', p->'pago'->'data')
        order by p->>'vencimento') from jsonb_array_elements(coalesce(f.data->'parcelas','[]'::jsonb)) p), '[]'::jsonb)
  ) from public.docs f where f.path = 'data/fin/demandas/' || p_dem;
$$;
revoke execute on function public.portal_fin(text) from public, anon, authenticated;

create or replace function public.portal_dados()
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v public.clientes_acesso; r jsonb; pd jsonb; pix jsonb;
begin
  select * into v from public.clientes_acesso where email = lower(coalesce(auth.jwt() ->> 'email', ''));
  if v.usuario is null then return null; end if;
  select data into pd from public.docs where path = 'portal/' || v.usuario;
  select case when coalesce(data->>'ativo','') = 'true' and coalesce(data->>'chave','') <> '' then jsonb_build_object('chave', data->'chave', 'nome', data->'nome', 'cidade', data->'cidade') end
    into pix from public.docs where path = 'data/fin/config/pix';
  select jsonb_build_object(
    'usuario', v.usuario, 'nome', v.nome, 'pix', pix,
    'msgs', coalesce(pd->'msgs', '[]'::jsonb),
    'agendamentos', coalesce(pd->'agendamentos', '[]'::jsonb),
    'avaliacoes', coalesce(pd->'avaliacoes', '[]'::jsonb),
    'processos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', split_part(d.path, '/', 2), 'codigo', d.data->'codigo', 'cliente', d.data->'cliente', 'servicos', d.data->'servicos',
        'etapa', d.data->'etapa', 'prazo', d.data->'prazo', 'municipio', d.data->'municipio', 'imovel', d.data->'imovel', 'areaHa', d.data->'areaHa',
        'protocoloOrgao', d.data->'protocoloOrgao', 'protocoloNumero', d.data->'protocoloNumero', 'protocoloPrevisao', d.data->'protocoloPrevisao',
        'fin', public.portal_fin(split_part(d.path, '/', 2)),
        'docs', coalesce((select jsonb_agg(jsonb_build_object('id', x->'id', 'nome', x->'nome', 'tipo', x->'tipo', 'tam', x->'tam', 'em', x->'em', 'rotulo', x->'rotulo'))
                          from jsonb_array_elements(coalesce(d.data->'docsCliente','[]'::jsonb)) x
                          where x->>'id' like 'portal/' || v.usuario || '/%'), '[]'::jsonb),
        'checklist', coalesce((select jsonb_agg(jsonb_build_object('t', i->'t', 'ok', i->'ok', 'doc', i->'doc')) from jsonb_array_elements(coalesce(d.data->'checklist','[]'::jsonb)) i), '[]'::jsonb),
        'etapas', coalesce((select jsonb_agg(jsonb_build_object('em', h->'em', 'txt', h->'txt')) from jsonb_array_elements(coalesce(d.data->'historico','[]'::jsonb)) h
                            where h->>'txt' like 'moveu de %' or h->>'txt' like 'criou a demanda%'), '[]'::jsonb),
        'agenda', coalesce((select jsonb_agg(jsonb_build_object('data', a.data->'data', 'prazo', a.data->'prazo', 'inicio', a.data->'inicio', 'tipo', a.data->'tipo'))
                            from public.docs a where a.col = 'agenda' and a.data->>'demandaId' = split_part(d.path, '/', 2)), '[]'::jsonb)
      ) order by d.data->>'codigo') from public.docs d where d.col = 'demandas' and split_part(d.path, '/', 2) = any(v.demandas)), '[]'::jsonb)
  ) into r;
  return r;
end $function$;

create or replace function public.portal_proposta(p_demanda text, p_acao text, p_nome text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.clientes_acesso; f jsonb; d jsonb; agora text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  hdr jsonb; ip text; ua text; ac jsonb; m jsonb; hist jsonb;
begin
  select * into v from public.clientes_acesso where email = lower(coalesce(auth.jwt() ->> 'email', ''));
  if v.usuario is null or not (p_demanda = any(v.demandas)) then raise exception 'sem acesso'; end if;
  select data into f from public.docs where path = 'data/fin/demandas/' || p_demanda;
  if f is null or f->'proposta'->>'status' <> 'enviada' then raise exception 'não há proposta aguardando resposta'; end if;
  begin hdr := current_setting('request.headers', true)::jsonb; exception when others then hdr := '{}'; end;
  ip := split_part(coalesce(hdr->>'x-forwarded-for', hdr->>'x-real-ip', ''), ',', 1);
  ua := left(coalesce(hdr->>'user-agent', ''), 200);
  if p_acao = 'aceitar' then
    if coalesce(trim(p_nome), '') = '' or length(trim(p_nome)) < 5 then raise exception 'digite seu nome completo para aceitar'; end if;
    if coalesce(f->'proposta'->>'validade','') <> '' and (f->'proposta'->>'validade')::date < (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'esta proposta venceu. Peça uma nova pelo chat.'; end if;
    ac := jsonb_build_object('em', agora, 'nome', left(trim(p_nome), 120), 'usuario', v.usuario, 'ip', ip, 'ua', ua);
    f := jsonb_set(f, '{proposta}', (f->'proposta') || jsonb_build_object('status', 'aceita', 'aceite', ac));
    m := jsonb_build_object('id', substr(md5(random()::text), 1, 10), 'em', agora, 'de', 'cliente',
      'texto', '✅ Aceitei a proposta ' || coalesce(f->'proposta'->>'numero', '') || ' (' || left(trim(p_nome), 120) || ').');
  elsif p_acao = 'recusar' then
    f := jsonb_set(f, '{proposta}', (f->'proposta') || jsonb_build_object('status', 'recusada', 'recusa', jsonb_build_object('em', agora, 'motivo', left(coalesce(p_motivo,''), 1000), 'ip', ip)));
    m := jsonb_build_object('id', substr(md5(random()::text), 1, 10), 'em', agora, 'de', 'cliente',
      'texto', 'Sobre a proposta ' || coalesce(f->'proposta'->>'numero', '') || ': ' || coalesce(nullif(trim(p_motivo), ''), 'gostaria de conversar sobre ajustes.'));
  else raise exception 'ação inválida'; end if;
  f := jsonb_set(f, '{log}', coalesce(f->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('em', agora, 'pessoa', 'cliente', 'txt', case when p_acao = 'aceitar' then 'cliente aceitou a proposta pelo portal' else 'cliente pediu ajuste na proposta' end)));
  update public.docs set data = f, updated_at = now() where path = 'data/fin/demandas/' || p_demanda;
  select data into d from public.docs where path = 'demandas/' || p_demanda;
  hist := coalesce(d->'historico', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('em', agora, 'pessoa', 'cliente',
            'txt', case when p_acao = 'aceitar' then 'cliente aceitou a proposta pelo portal' else 'cliente pediu ajuste na proposta' end));
  if p_acao = 'aceitar' and d->>'etapa' = 'Orçamento' then
    hist := hist || jsonb_build_array(jsonb_build_object('em', agora, 'pessoa', 'cliente', 'txt', 'moveu de Orçamento para Aguardando entrada'));
    update public.docs set data = data || jsonb_build_object('etapa', 'Aguardando entrada', 'historico', hist, 'atualizadoEm', agora, 'atualizadoPor', 'cliente'), updated_at = now() where path = 'demandas/' || p_demanda;
  else
    update public.docs set data = data || jsonb_build_object('historico', hist, 'atualizadoEm', agora), updated_at = now() where path = 'demandas/' || p_demanda;
  end if;
  update public.docs set data = jsonb_set(data, '{msgs}', coalesce(data->'msgs','[]'::jsonb) || m) || jsonb_build_object('ultimaCliente', m->'em'), updated_at = now()
   where path = 'portal/' || v.usuario;
  return f->'proposta';
end $$;
revoke execute on function public.portal_proposta(text, text, text, text) from public, anon;
grant execute on function public.portal_proposta(text, text, text, text) to authenticated;

-- ---------- Automações por etapa ----------
create or replace function public.tg_automacoes() returns trigger
language plpgsql security definer set search_path = public as $$
declare regras jsonb; r jsonb; ac jsonb; cl jsonb; it text; u text; txt text; autor text; mudou text[] := '{}';
  vars jsonb; m jsonb; agora text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); emails text[];
begin
  if new.col <> 'demandas' or coalesce(new.data->>'exemplo','') = 'true' then return new; end if;
  if tg_op = 'UPDATE' and (new.data->>'etapa') is not distinct from (old.data->>'etapa') then return new; end if;
  select data->'regras' into regras from public.docs where path = 'config/automacoes';
  if regras is null or jsonb_typeof(regras) <> 'array' then return new; end if;
  autor := coalesce(nullif(new.data->>'atualizadoPor', 'cliente'), new.data->>'responsavel', 'isabella-cleto');
  vars := jsonb_build_object('{cliente}', split_part(coalesce(new.data->>'cliente',''), ' — ', 1), '{primeiro_nome}', split_part(split_part(coalesce(new.data->>'cliente',''), ' — ', 1), ' ', 1),
    '{codigo}', coalesce(new.data->>'codigo',''), '{etapa}', coalesce(new.data->>'etapa',''), '{imovel}', coalesce(nullif(split_part(coalesce(new.data->>'cliente',''), ' — ', 2), ''), new.data->>'imovel', ''),
    '{protocolo}', coalesce(new.data->>'protocoloNumero',''), '{orgao}', coalesce(new.data->>'protocoloOrgao',''));
  for r in select * from jsonb_array_elements(regras) loop
    if coalesce(r->>'ativa','true') <> 'true' or r->>'etapa' is distinct from new.data->>'etapa' then continue; end if;
    ac := coalesce(r->'acoes', '{}'::jsonb);
    -- checklist
    if jsonb_typeof(ac->'checklist') = 'array' and jsonb_array_length(ac->'checklist') > 0 then
      cl := coalesce(new.data->'checklist', '[]'::jsonb);
      for it in select jsonb_array_elements_text(ac->'checklist') loop
        if trim(it) <> '' and not exists (select 1 from jsonb_array_elements(cl) x where lower(x->>'t') = lower(trim(it))) then
          cl := cl || jsonb_build_array(jsonb_build_object('id', substr(md5(random()::text || it), 1, 8), 't', trim(it), 'ok', false, 'auto', true));
        end if;
      end loop;
      new.data := jsonb_set(new.data, '{checklist}', cl); mudou := array_append(mudou, 'checklist');
    end if;
    if coalesce(ac->>'responsavel','') <> '' and ac->>'responsavel' is distinct from new.data->>'responsavel' then
      new.data := new.data || jsonb_build_object('responsavel', ac->>'responsavel'); mudou := array_append(mudou, ('responsável: ' || public.nome_pessoa(ac->>'responsavel')));
    end if;
    if coalesce(ac->>'prazoDias','') ~ '^\d+$' and (coalesce(new.data->>'prazo','') = '' or coalesce(ac->>'sobrescreverPrazo','') = 'true') then
      new.data := new.data || jsonb_build_object('prazo', to_char((now() at time zone 'America/Sao_Paulo')::date + (ac->>'prazoDias')::int, 'YYYY-MM-DD'));
      mudou := array_append(mudou, ('prazo em ' || (ac->>'prazoDias') || ' dias'));
    end if;
    if coalesce(trim(ac->>'msgCliente'),'') <> '' then
      txt := ac->>'msgCliente';
      for it in select jsonb_object_keys(vars) loop txt := replace(txt, it, vars->>it); end loop;
      for u in select usuario from public.clientes_acesso where split_part(new.path, '/', 2) = any(demandas) loop
        m := jsonb_build_object('id', substr(md5(random()::text), 1, 10), 'em', agora, 'texto', left(txt, 2000), 'de', autor, 'auto', true);
        update public.docs set data = jsonb_set(data, '{msgs}', coalesce(data->'msgs','[]'::jsonb) || m) || jsonb_build_object('ultimaEquipe', agora), updated_at = now()
          where path = 'portal/' || u;
        if found then mudou := array_append(mudou, 'mensagem ao cliente'); end if;
      end loop;
    end if;
    if jsonb_typeof(ac->'avisar') = 'array' and jsonb_array_length(ac->'avisar') > 0 then
      select array_agg(e.email) into emails from public.equipe e where e.pessoa in (select jsonb_array_elements_text(ac->'avisar'));
      txt := coalesce(nullif(trim(ac->>'avisoTexto'),''), 'Processo entrou na etapa {etapa}');
      for it in select jsonb_object_keys(vars) loop txt := replace(txt, it, vars->>it); end loop;
      perform public.enviar_push(emails, null, jsonb_build_object('title', (new.data->>'codigo') || ' · ' || (new.data->>'etapa'), 'body', left(txt, 160),
        'tag', 'auto-' || split_part(new.path, '/', 2), 'abrir', 'demanda:' || split_part(new.path, '/', 2)));
      mudou := array_append(mudou, 'aviso à equipe');
    end if;
    if array_length(mudou, 1) > 0 then
      new.data := jsonb_set(new.data, '{historico}', coalesce(new.data->'historico','[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('em', agora, 'pessoa', 'automacao', 'txt', 'automação "' || coalesce(r->>'nome', r->>'etapa') || '": ' || array_to_string(mudou, ', '))));
      mudou := '{}';
    end if;
  end loop;
  return new;
exception when others then
  raise warning 'automação falhou: %', sqlerrm;
  return new;
end $$;
