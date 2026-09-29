const fs = require('fs');
const path = require('path');

// Uso: node mynode.js [dev|prod]
//   dev  -> src/environments/environments.development.ts  (npm start)
//   prod -> src/environments/environments.prod.ts       (build da Vercel)
//
// As chaves vem de process.env. Em dev, mynode.js le src/.env; na Vercel as
// chaves ja chegam no ambiente do build. dotenv nao sobrescreve variavel que ja
// existe, entao a Vercel sempre ganha caso src/.env exista por engano.
//
// A URL e a chave anon do Supabase. A anon key e publica por definicao e vai no
// bundle do navegador de qualquer jeito; o que nao pode ir e a service_role.

const erro = '\x1b[31m%s\x1b[0m';
const ok = '\x1b[32m%s\x1b[0m';
const checkSign = '\u{2705}';

const modo = process.argv[2] === 'prod' ? 'prod' : 'dev';
const destino = path.join(
  __dirname,
  `./src/environments/environments.${modo === 'prod' ? 'prod' : 'development'}.ts`
);

if (modo === 'dev') {
  require('dotenv').config({ path: 'src/.env' });
}

function problema(mensagem) {
  console.error(erro, `\u{274C} ${mensagem}`);
  process.exit(1);
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_KEY || '').trim();
const redirect = (process.env.REDIRECT_URL || '').trim();

const faltando = [];
if (!url) faltando.push('SUPABASE_URL');
if (!key) faltando.push('SUPABASE_KEY');

if (faltando.length) {
  problema(
    `Faltou ${faltando.join(' e ')} no ambiente do build. ` +
      (modo === 'dev'
        ? 'Crie src/.env com SUPABASE_URL, SUPABASE_KEY e REDIRECT_URL.'
        : 'Cadastre as duas em Settings > Environment Variables do projeto na Vercel, ' +
          'no ambiente correspondente (Preview para develop, Production para main).')
  );
}

if (!/^https:\/\/[a-z0-9]+\.supabase\.(co|in)$/.test(url)) {
  problema(
    `SUPABASE_URL invalida: "${url}". Esperado https://<project-ref>.supabase.co. ` +
      'Confira se colou a URL do projeto certo.'
  );
}

// Aceita a chave anon legada (JWT) e a publishable nova (sb_publishable_...).
if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key) &&
    !/^sb_(publishable|secret)_[A-Za-z0-9_-]+$/.test(key)) {
  problema(
    'SUPABASE_KEY nao parece uma chave do Supabase. Use a anon/publishable, nunca a service_role.'
  );
}

// A service_role contorna RLS e nao pode ir para o bundle do navegador. O
// formato de JWT e identico ao da anon, entao so da para diferenciar lendo o
// payload.
if (key.startsWith('eyJ')) {
  let role = null;
  try {
    role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
  } catch {
    problema('SUPABASE_KEY nao e um JWT legivel.');
  }
  if (role !== 'anon') {
    problema(
      `SUPABASE_KEY tem role "${role}", nao "anon". ` +
        'A service_role burla RLS e nao pode ir para o bundle. Pegue a chave anon.'
    );
  }
}
if (key.startsWith('sb_secret_')) {
  problema('SUPABASE_KEY e sb_secret_ (secret). Use a publishable, nunca a secret.');
}

// =====================================================
// A MARCA DO PWA
// --------------------------------------------------------
// O PRD e o DES sao o mesmo aplicativo apontando para bancos diferentes, e o
// PWA instalado na tela de inicio erixa em dois icones parecidos. A distincao
// que importa nao esta no codigo: esta no ref do projeto, que ja esta na URL
// que o build exigiu. Entao a URL decide a marca.
//
// A distincao visivel de verdade e o nome e a cor do manifesto, porque e o que
// o sistema operacional mostra DEBAIXO do icone e na splash. Os PNGs sao
// placeholders: o script copia os arquivos de pwa/<marca>/ para public/, entao
// trocar a logo de verdade e so substituir o arquivo la.
const MARCAS = {
  'vzmzvhiqfswksyrgyecm': { pasta: 'prd', rotulo: 'PRD' },
  'cpnlcjwgwaaeptyudzec': { pasta: 'des', rotulo: 'DES' }
};

// So a URL; a chave e a unica variavel que muda entre os dois e ja foi lida.
const ref = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\./) || [])[1];
const marca = MARCAS[ref];

// Arquivos que o index.html e o manifest referenciam por nome fixo. Sao
// exatamente estes que precisam variar; a pasta public/icons nao entra aqui
// porque nada a referencia.
const ARQUIVOS_PWA = [
  'favicon.svg',
  'favicon.ico',
  'favicon-96x96.png',
  'apple-touch-icon.png',
  'web-app-manifest-192x192.png',
  'web-app-manifest-512x512.png',
  'manifest.webmanifest'
];

function aplicarMarcaPwa() {
  if (!marca) {
    // Projeto novo, ou um terceiro. Deixa o que esta em public/ como esta, em
    // vez de falhar o build: a marca e uma convenience, nao uma condicao.
    console.log(`   PWA: ref "${ref || 'desconhecido'}" fora do mapa, mantida a marca atual`);
    return;
  }

  const origem = path.join(__dirname, 'pwa', marca.pasta);
  if (!fs.existsSync(origem)) {
    console.log(`   PWA: pwa/${marca.pasta}/ nao existe, mantida a marca atual`);
    return;
  }

  for (const arquivo of ARQUIVOS_PWA) {
    const de = path.join(origem, arquivo);
    if (!fs.existsSync(de)) continue;
    fs.copyFileSync(de, path.join(__dirname, 'public', arquivo));
  }

  console.log(ok, `   PWA: marca ${marca.rotulo} (pwa/${marca.pasta}/ -> public/)`);
}

// Sem barra no final: o redirect concatena o caminho e a barra viraria barra dupla.
const redirectNormalizado = redirect.replace(/\/+$/, '');

const conteudo = `// Arquivo GERADO por mynode.js. Nao editar a mao e nao versionar.
// Fonte: variaveis de ambiente do build (Vercel) ou src/.env (local).
export const environment = {
    SUPABASE_URL: '${url}',
    SUPABASE_KEY: '${key}',
    // Sem barra no final: o redirect concatena o caminho.
    REDIRECT_URL: ${redirectNormalizado ? `'${redirectNormalizado}'` : 'window.location.origin'}
  };
`;

fs.writeFile(destino, conteudo, (err) => {
  if (err) {
    console.error(erro, err);
    process.exit(1);
  }
  console.log(ok, `✅ environments.${modo === 'prod' ? 'prod' : 'development'}.ts gerado`);
  console.log(ok, `   SUPABASE_URL: ${url}`);
  console.log(ok, `   REDIRECT_URL: ${redirectNormalizado || '(fallback: window.location.origin)'}`);

  // A marca vai depois do arquivo, e nao antes: assim o build ja comeca com
  // public/ na versao certa mesmo que a escrita acima tenha sido assincrona.
  aplicarMarcaPwa();
});

