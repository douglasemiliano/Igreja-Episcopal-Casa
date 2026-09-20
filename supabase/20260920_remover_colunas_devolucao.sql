-- Execute somente se 20260920_adicionar_devolucao_itens.sql ja tiver sido aplicado.
alter table public.itens_venda_arrecadacao
  drop column if exists devolvido,
  drop column if exists devolvido_em;