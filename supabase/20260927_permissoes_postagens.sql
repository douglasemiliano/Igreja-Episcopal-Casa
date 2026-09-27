-- =====================================================
-- Permissões das publicações do feed
-- =====================================================
-- Fecha as regras do feed em duas linhas:
--
--   UPDATE  somente quem escreveu
--   DELETE  quem escreveu, administrador e pastor
--
-- Antes (20260925) o UPDATE e o DELETE eram praticamente iguais e ambos
-- abriam para o administrador:
--
--   using (autor_id = auth.uid() or tem_perfil(array['administrador']))
--
-- O que muda na prática:
--
--   * Administrador e pastor deixam de conseguir reescrever o texto de
--     alguém. Se precisarem falar por outra pessoa, publicam do próprio
--     perfil ou removem o post e criam outro.
--   * Pastor entra no DELETE, que antes era só do autor e do administrador.
--     Um moderador sem acesso ao código não tinha como tirar do ar um post
--     alheio.
--
-- INSERT e SELECT não mudam: publicar segue restrito a administrador e líder,
-- e a leitura continua aberta a qualquer autenticado.

-- =====================================================
-- 1) UPDATE: só o autor
-- =====================================================
-- `with check` também vale `autor_id = auth.uid()`. Sem ele, o autor poderia
-- reescrever a própria linha e transferir a autoria para outra pessoa,
-- contornando a regra de "cada um edita o que é dele".
drop policy if exists "Autor ou administrador editam publicação" on public.feed_publicacoes;
create policy "Autor edita a própria publicação" on public.feed_publicacoes
  for update to authenticated
  using (autor_id = auth.uid())
  with check (autor_id = auth.uid());

-- =====================================================
-- 2) DELETE: autor, administrador e pastor
-- =====================================================
-- Excluir é mais largo que editar de propósito: quem não pode mexer no texto
-- de terceiro ainda precisa poder tirar o post do ar.
drop policy if exists "Autor ou administrador removem publicação" on public.feed_publicacoes;
create policy "Autor, administrador e pastor removem publicação" on public.feed_publicacoes
  for delete to authenticated
  using (
    autor_id = auth.uid()
    or public.tem_perfil(array['administrador'])
    or public.tem_perfil(array['pastor'])
  );

-- =====================================================
-- 3) Conferência
-- =====================================================
-- Deve listar exatamente estas quatro policies. Se "Administrador e líder
-- publicam no feed" ou "Todos autenticados leem o feed" sumirem, algo nesta
-- migration foi rodada pela metade e vale reexecutar.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'feed_publicacoes'
order by policyname;

-- O trigger de `atualizado_em` continua valendo: sem ele, o card do feed
-- para de mostrar a marca "editado" depois de um UPDATE.
select tgname
from pg_trigger
where tgrelid = 'public.feed_publicacoes'::regclass
  and not tgisinternal;
