create or replace function public.tg_push_docs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n_new int; n_old int; m jsonb; autor text; titulo text; corpo text; emails text[]; usuarios text[];
  cli text; dem text; u text; na_new int; na_old int;
begin
  if coalesce(new.data->>'exemplo','') = 'true' then return new; end if;
  n_new := coalesce(jsonb_array_length(case when jsonb_typeof(new.data->'msgs') = 'array' then new.data->'msgs' end), 0);
  n_old := 0;
  if tg_op = 'UPDATE' then
    n_old := coalesce(jsonb_array_length(case when jsonb_typeof(old.data->'msgs') = 'array' then old.data->'msgs' end), 0);
  end if;

  if (new.col = 'mural' or new.col like 'demandas/%/conversa') and n_new > n_old then
    m := new.data->'msgs'->(n_new - 1); autor := new.data->>'pessoa';
    corpo := public.nome_pessoa(autor) || ': ' || coalesce(nullif(left(m->>'texto', 140), ''), 'enviou um arquivo');
    if new.col = 'mural' then
      titulo := 'Mural da equipe'; dem := null;
    else
      dem := split_part(new.path, '/', 2);
      select data->>'cliente' into cli from public.docs where path = 'demandas/' || dem;
      titulo := 'Conversa · ' || coalesce(split_part(cli, ' — ', 1), 'demanda');
    end if;
    select array_agg(email) into emails from public.equipe where pessoa is distinct from autor;
    perform public.enviar_push(emails, null, jsonb_build_object('title', titulo, 'body', corpo,
      'tag', 'chat-' || coalesce(dem, 'mural'), 'abrir', coalesce('conversa:' || dem, 'mural')));

  elsif new.col = 'portal' then
    u := split_part(new.path, '/', 2);
    if n_new > n_old then
      m := new.data->'msgs'->(n_new - 1);
      if m->>'de' = 'cliente' then
        select nome into cli from public.clientes_acesso where usuario = u;
        select array_agg(email) into emails from public.equipe;
        perform public.enviar_push(emails, null, jsonb_build_object(
          'title', (case when m->>'tipo' = 'agendamento' then 'Agendamento · ' else 'Cliente · ' end) || coalesce(cli, u),
          'body', coalesce(nullif(left(m->>'texto', 140), ''), (case when m->>'tipo' = 'agendamento' then 'Atualizou um pedido de agendamento' else 'Enviou um arquivo' end)),
          'tag', 'portal-' || u, 'abrir', 'portal:' || u));
      else
        perform public.enviar_push(null, array[u], jsonb_build_object(
          'title', (case when m->>'tipo' = 'agendamento' then 'Agendamento · Saotech' else 'Saotech respondeu' end),
          'body', coalesce(nullif(left(m->>'texto', 140), ''), (case when m->>'tipo' = 'agendamento' then 'Há uma atualização no seu agendamento' else 'Você recebeu um arquivo' end)),
          'tag', 'portal', 'abrir', 'portal'));
      end if;
    end if;
    na_new := coalesce(jsonb_array_length(case when jsonb_typeof(new.data->'avaliacoes') = 'array' then new.data->'avaliacoes' end), 0);
    na_old := 0;
    if tg_op = 'UPDATE' then
      na_old := coalesce(jsonb_array_length(case when jsonb_typeof(old.data->'avaliacoes') = 'array' then old.data->'avaliacoes' end), 0);
    end if;
    if na_new > 0 and (na_new > na_old or (tg_op = 'UPDATE' and new.data->'avaliacoes' is distinct from old.data->'avaliacoes')) then
      m := new.data->'avaliacoes'->(na_new - 1);
      select array_agg(email) into emails from public.equipe;
      perform public.enviar_push(emails, null, jsonb_build_object('title', 'Nova avaliação · ' || coalesce(m->>'nome', u),
        'body', repeat('★', coalesce((m->>'nota')::int, 0)) || coalesce(' ' || nullif(left(m->>'comentario', 120), ''), ''),
        'tag', 'avaliacao-' || u, 'abrir', 'portal:' || u));
    end if;

  elsif new.col = 'demandas' then
    dem := split_part(new.path, '/', 2);
    if coalesce(new.data->>'responsavel','') <> '' and coalesce(new.data->>'responsavel','') <> coalesce(new.data->>'atualizadoPor','')
       and (tg_op = 'INSERT' or (new.data->>'responsavel') is distinct from (old.data->>'responsavel')) then
      select array_agg(email) into emails from public.equipe where pessoa = new.data->>'responsavel';
      perform public.enviar_push(emails, null, jsonb_build_object('title', 'Nova demanda para você',
        'body', coalesce(new.data->>'codigo', '') || ' · ' || coalesce(new.data->>'cliente', '') || ' (por ' || public.nome_pessoa(new.data->>'atualizadoPor') || ')',
        'tag', 'dem-' || dem, 'abrir', 'demanda:' || dem));
    end if;
    if tg_op = 'UPDATE' then
      if (new.data->>'etapa') is distinct from (old.data->>'etapa') then
        select array_agg(usuario) into usuarios from public.clientes_acesso where dem = any(demandas);
        if usuarios is not null then
          cli := split_part(coalesce(new.data->>'cliente',''), ' — ', 2);
          perform public.enviar_push(null, usuarios, jsonb_build_object('title', 'Seu processo avançou',
            'body', (case when cli <> '' then cli || ': ' else '' end) || 'agora na etapa ' || coalesce(new.data->>'etapa', ''),
            'tag', 'etapa-' || dem, 'abrir', 'portal'));
        end if;
      end if;
    end if;
  end if;
  return new;
exception when others then
  raise warning 'push falhou: %', sqlerrm;
  return new;
end $$;
