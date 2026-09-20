-- Um fiado pode estar pendente ou pago depois da quitação.
alter table public.vendas_arrecadacao
  drop constraint if exists fiado_deve_estar_pendente;

-- Mantém a regra de que toda venda fiada precisa ter um membro responsável.
alter table public.vendas_arrecadacao
  drop constraint if exists fiado_deve_ter_membro;

alter table public.vendas_arrecadacao
  add constraint fiado_deve_ter_membro
  check (
    forma_pagamento <> 'fiado'
    or membro_id is not null
  );