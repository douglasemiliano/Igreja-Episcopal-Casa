alter table public.itens_venda_arrecadacao
  add column if not exists devolvido boolean not null default false;

alter table public.itens_venda_arrecadacao
  add column if not exists devolvido_em timestamptz;