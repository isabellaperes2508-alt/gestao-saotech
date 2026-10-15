-- Gestão Saotech · zerar os dados e manter só a equipe e as configurações
-- Antes de rodar, existe uma cópia de segurança completa (Histórico → Cópias de segurança).
begin;
alter table public.docs disable trigger para_lixeira;
delete from public.docs where col <> 'config' and col not like 'data/fin/config%';
delete from public.docs where path = 'config/anotacoes';
delete from public.lixeira;
delete from public.clientes_acesso;
delete from auth.users where email like '%@clientes.saotech.com.br';
alter table public.docs enable trigger para_lixeira;
commit;
