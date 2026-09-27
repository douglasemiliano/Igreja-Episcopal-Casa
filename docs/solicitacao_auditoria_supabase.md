# Solicitação de Code Review e Auditoria de Segurança: Supabase & SQL Injection

Olá! Preciso de uma validação técnica sobre a segurança da minha aplicação que utiliza o **Supabase**. Como as chaves de API e as chamadas ficam visíveis no front-end, quero garantir que a arquitetura está blindada contra vazamento de dados e tentativas de SQL Injection.

Por favor, analise o código e as configurações fornecidas e valide os pontos abaixo:

## 1. Verificação de Row Level Security (RLS)
O RLS é a principal camada de defesa da aplicação.
- [ ] O RLS está devidamente **ativado** em todas as tabelas expostas?
- [ ] As políticas (*Policies*) de SELECT, INSERT, UPDATE e DELETE estão restringindo o acesso baseado no `auth.uid()` ou em papéis autenticados?
- [ ] Existe algum cenário onde um usuário autenticado conseguiria acessar dados de terceiros?

## 2. Análise de Funções do Banco de Dados (RPC)
Se houver funções personalizadas no Postgres sendo chamadas via `.rpc()`:
- [ ] Elas utilizam SQL dinâmico (`EXECUTE`) concatenando variáveis de entrada? (Se sim, precisamos corrigir para queries parametrizadas).
- [ ] Alguma função está configurada com `SECURITY DEFINER` desnecessariamente? Se sim, ela possui o `search_path` explicitamente definido e valida rigorosamente os parâmetros de entrada?

## 3. Vazamento de Credenciais
- [ ] A chave `service_role` (Service Key) está totalmente ausente do front-end e do repositório público?
- [ ] Apenas a chave `anon` está exposta no lado do cliente?

## 4. Validação de Dados e Lógica de Entrada
- [ ] Há validação de esquemas (ex: Zod, Yup) no front-end ou em Edge Functions para impedir payloads maliciosos?
- [ ] Existem operações críticas que deveriam ser migradas do front-end para **Supabase Edge Functions** ou rotas de back-end protegidas?

---

### Código / Estrutura para Análise
*(Cole aqui os trechos do seu código frontend, políticas do banco ou definições de funções que você quer que o Big Pícaro analise)*

```javascript
// Exemplo de chamada ao Supabase no Front-end ou Edge Function
```

```sql
-- Exemplo de Políticas (Policies) ou Funções SQL do seu banco
```
