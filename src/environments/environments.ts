// Valores de PRODUCAO. O build de desenvolvimento troca este arquivo pelo
// environments.development.ts via fileReplacements (ver angular.json).
//
// A chave abaixo e a chave anon do Supabase: ela e feita para ser publica e
// vai no bundle do navegador de qualquer jeito. O que nao pode ir para o
// bundle e a service_role.
//
// Se a producao usar outro projeto Supabase, troque SUPABASE_URL e SUPABASE_KEY
// aqui.
export const environment = {
    SUPABASE_URL: 'https://cpnlcjwgwaaeptyudzec.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwbmxjandnd2FhZXB0eXVkemVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU0MzAwMTAsImV4cCI6MjA2MTAwNjAxMH0.R0mxsuT6bdtvqyX8cevpzQLZIIkW0TuQgM3BeDCPbi4',
    // Sem barra no final: o redirect concatena o caminho e a barra viraria
    // barra dupla na URL.
    REDIRECT_URL: 'https://icasa.vercel.app'
  };
