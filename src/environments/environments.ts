// Placeholder. Nao e mais a fonte de nenhum build.
//
// Antes este arquivo carregava a URL e a chave do Supabase e ia direto para o
// bundle, o que fazia os dois ambientes apontarem para o mesmo banco. Agora:
//
//   dev  -> src/.env        via mynode.js -> environments.development.ts
//   prod -> Vercel          via mynode.js -> environments.prod.ts
//
// O build falha se SUPABASE_URL ou SUPABASE_KEY nao estiverem definidas, para
// nunca publicar silenciosamente o banco errado.
//
// Este arquivo so existe para satisfazer o compilador de editor. Ele nao precisa
// ter valor real.
export const environment = {
    SUPABASE_URL: '',
    SUPABASE_KEY: '',
    REDIRECT_URL: '',
  };
