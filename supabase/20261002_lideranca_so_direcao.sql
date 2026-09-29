-- =====================================================
-- Liderança de célula: só a direção da igreja nomeia líder
--
-- O que estava errado
-- -------------------
-- `pode_vincular_esta_celula()` é a regra que hoje abre as três policies de
-- escrita de `celula_membros`, e ela vale para o LÍDER DA CÉLULA. Ela responde
-- "esta pessoa pode mexer no grupo DESTA célula?", e essa pergunta nunca
-- olhava o valor da coluna `papel`. Consequência: qualquer líder podia, na
-- própria célula:
--
--   * tirar a própria liderança   (update do próprio papel para 'membro')
--   * promover quem quisesse      (update do papel de outro para 'lider')
--   * rebaixar o outro líder      (update para 'membro')
--   * admitir já como líder    (insert com papel = 'lider')
--   * remover o líder pela porta de trás (delete da linha, que é rebaixar sem
--     passar pelo update)
--
-- Tudo isso verificado em teste, não em leitura de código: as quatro primeiras
-- passaram. A quinta é a que costuma sobrar numa correção que só olha o update.
--
-- A regra
-- -------
-- Formar o grupo é do líder: ele escolhe quem participa da célula dele. Isso
-- segue como estava.
--
-- Definir QUEM LIDERA é decisão de direção da igreja, e não de quem está
-- conduzindo: só administrador, pastor e secretaria. Um líder que sai da célula
-- deixa de conduzir, e uma célula não pode ficar sem líder por decisão de quem
-- já estava nela — quem nomeia é quem pode nomear de novo.
--
-- Onde isso é imposto
-- -------------------
-- Nas policies, não na tela. A tela esconde o botão; o banco recusa a escrita.
-- Se a regra morasse só no TypeScript, um update direto pela API passaria, e
-- quem escreve pela API é exatamente quem não lê o componente.
--
-- Idempotente: `drop policy if exists` + `create policy`.
-- =====================================================

begin;

-- =====================================================
-- 1) INSERT — entrar no grupo
-- =====================================================
-- Entrar como `membro` é formar o grupo: o líder da célula pode.
-- Entrar já como `lider` é nomear alguém: só a direção.
drop policy if exists "Quem forma a celula insere membros" on public.celula_membros;
create policy "Quem forma a celula insere membros" on public.celula_membros
  for insert to authenticated
  with check (
       (papel = 'membro' and public.pode_vincular_esta_celula(celula_id))
    or (papel = 'lider'  and public.pode_formar_qualquer_celula())
  );

-- =====================================================
-- 2) UPDATE — mudar de papel
-- =====================================================
-- A única coluna mutável de `celula_membros` é `papel` (as outras duas são a
-- chave primária, e `criado_em` é preenchida pelo banco). Ou seja: qualquer
-- update que passa aqui É uma mudança de liderança — para cima, para baixo ou
-- a própria. Não há caso legítimo de update que não seja nomear ou exonerar,
-- então a policy inteira fica com a direção, sem perpetuate a distinção.
--
-- Dupla trava sobre a auto-exonerar: mesmo que alguém ajustasse a policy de
-- insert, remover a própria liderança por update continuaria fechado.
drop policy if exists "Quem forma a celula promove membros" on public.celula_membros;
create policy "So a direcao define lideranca" on public.celula_membros
  for update to authenticated
  using      (public.pode_formar_qualquer_celula())
  with check (public.pode_formar_qualquer_celula());

-- =====================================================
-- 3) DELETE — sair do grupo
-- =====================================================
-- Esta é a porta de trás da número 2: apagar a linha de um líder é o mesmo que
-- rebaixá-lo, e o `using` enxerga o `papel` da linha que está sendo apagada.
-- Sem esta distinção, o líder continuaria tirando o outro líder de lá — e a si
-- mesmo — sem nunca passar pelo update.
drop policy if exists "Quem forma a celula remove membros" on public.celula_membros;
create policy "Quem forma a celula remove membros" on public.celula_membros
  for delete to authenticated
  using (
       (papel = 'membro' and public.pode_vincular_esta_celula(celula_id))
    or (papel = 'lider'  and public.pode_formar_qualquer_celula())
  );

-- =====================================================
-- 4) O NOME DA FUNÇÃO PASSA A MENTIR UM POUCO
-- =====================================================
-- `pode_formar_qualquer_celula()` continua sendo a regra certa e não foi
-- duplicada: é exatamente a mesma lista de papéis, e a própria migration
-- 20261001 diz que uma regra escrita em três lugares é uma regra que alguém
-- corrige em duas. O que muda é que ela agora responde também a "pode nomear
-- líder?", e o comentário antigo só falava da formação.
comment on function public.pode_formar_qualquer_celula() is
  'Direcao da igreja (administrador, pastor, secretaria). Vale tanto para formar o grupo de qualquer celula quanto para definir QUEM LIDERA - as duas coisas sao decisao de direcao.';

-- `pode_vincular_esta_celula()` segue igual: forma o grupo da própria célula.
-- Só perdeu a exclusividade sobre o papel, que é o ponto deste arquivo.
comment on function public.pode_vincular_esta_celula(uuid) is
  'Verdadeiro para quem lidera a celula informada ou para quem pode formar qualquer celula. Vale para MONTAR o grupo (inserir e remover participante comum); nao reacha definir lideranca, que e de pode_formar_qualquer_celula().';

commit;

-- =====================================================
-- 5) COMO CONFERIR
-- =====================================================
-- 5.1) As policies ficaram como esperado:
--
--   select policyname, cmd, qual, with_check from pg_policies
--    where schemaname = 'public' and tablename = 'celula_membros'
--    order by cmd, policyname;
--
-- 5.2) O papel de direção continua com acesso total, e é preciso testar com
-- uma conta administrator, pastor ou secretaria:
--
--   select public.pode_formar_qualquer_celula();   -- true
--   select public.pode_vincular_esta_celula('<celula>');  -- true
--
-- 5.3) O líder perde a liderança e a nomeação, e GANHA o resto:
--
--   select public.pode_formar_qualquer_celula();   -- false
--   select public.pode_vincular_esta_celula('<celula_dele>');  -- true
