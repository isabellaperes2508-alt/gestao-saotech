-- =====================================================================
-- Gestão Saotech — banco de dados (Supabase, plano gratuito)
-- Cole tudo no Supabase → SQL Editor → New query → Run.
-- Pode rodar de novo sem problema: o script não duplica nada.
-- =====================================================================

-- 1) Equipe: quem pode entrar e quem é administrador (vê o Financeiro)
create table if not exists public.equipe (
  email  text primary key,
  pessoa text not null,          -- moises-bruno | joao-marcos | moises-junior | isabella-cleto
  nome   text not null,
  admin  boolean not null default false
);

-- 2) Documentos do painel (demandas, conversas, agenda, registros, etc.)
create table if not exists public.docs (
  path       text primary key,
  col        text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists docs_col_idx on public.docs (col);

-- 3) Funções de permissão
create or replace function public.e_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipe where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
create or replace function public.e_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipe where email = lower(coalesce(auth.jwt() ->> 'email', '')) and admin);
$$;

-- 4) Regras de acesso (RLS)
alter table public.equipe enable row level security;
alter table public.docs   enable row level security;

drop policy if exists "equipe_ler" on public.equipe;
create policy "equipe_ler" on public.equipe for select to authenticated using (public.e_membro());

drop policy if exists "docs_ler"     on public.docs;
drop policy if exists "docs_inserir" on public.docs;
drop policy if exists "docs_alterar" on public.docs;
drop policy if exists "docs_apagar"  on public.docs;
-- Financeiro (col começando com data/fin) só para administradores
create policy "docs_ler" on public.docs for select to authenticated
  using (public.e_membro() and (col not like 'data/fin%' or public.e_admin()));
create policy "docs_inserir" on public.docs for insert to authenticated
  with check (public.e_membro() and (col not like 'data/fin%' or public.e_admin()));
create policy "docs_alterar" on public.docs for update to authenticated
  using (public.e_membro() and (col not like 'data/fin%' or public.e_admin()))
  with check (public.e_membro() and (col not like 'data/fin%' or public.e_admin()));
create policy "docs_apagar" on public.docs for delete to authenticated
  using (public.e_membro() and (col not like 'data/fin%' or public.e_admin()));

-- 5) Atualização em tempo real
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 6) Arquivos (fotos de campo, PDFs) — pasta privada de até 20 MB por arquivo
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "anexos_ler"    on storage.objects;
drop policy if exists "anexos_enviar" on storage.objects;
drop policy if exists "anexos_apagar" on storage.objects;
create policy "anexos_ler"    on storage.objects for select to authenticated using (bucket_id = 'anexos' and public.e_membro());
create policy "anexos_enviar" on storage.objects for insert to authenticated with check (bucket_id = 'anexos' and public.e_membro());
create policy "anexos_apagar" on storage.objects for delete to authenticated using (bucket_id = 'anexos' and public.e_membro());

-- 7) Cadastro da equipe (e-mails já usados na Agenda de campo)
insert into public.equipe (email, pessoa, nome, admin) values
  ('moisesbrunos@hotmail.com',    'moises-bruno',   'Moisés Bruno',   true),
  ('isabellaperes2508@gmail.com', 'isabella-cleto', 'Isabella Cleto', true),
  ('joaomarcospds16@gmail.com',   'joao-marcos',    'João Marcos',    false),
  ('moisesjuniortma@gmail.com',   'moises-junior',  'Moisés Júnior',  false)
on conflict (email) do update set pessoa = excluded.pessoa, nome = excluded.nome, admin = excluded.admin;

-- E-mails para convites do Google Agenda
insert into public.docs (path, col, data) values
  ('config/equipe', 'config', '{"emails":{"moises-bruno":"moisesbrunos@hotmail.com","isabella-cleto":"isabellaperes2508@gmail.com","joao-marcos":"joaomarcospds16@gmail.com","moises-junior":"moisesjuniortma@gmail.com"}}')
on conflict (path) do nothing;

-- 8) Permissões de acesso às tabelas (necessário em projetos novos do Supabase)
grant usage on schema public to anon, authenticated;
grant select on public.equipe to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant execute on function public.e_membro() to authenticated;
grant execute on function public.e_admin() to authenticated;
