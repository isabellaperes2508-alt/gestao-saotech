# Gestão Saotech — como colocar no ar de graça

A plataforma usa dois serviços gratuitos:

- **Supabase**: guarda os dados, os arquivos e os logins da equipe.
- **GitHub Pages**: hospeda as páginas e gera o link de acesso.

O processo leva cerca de 30 minutos e não pede cartão de crédito.

## Arquivos desta pasta

| Arquivo | Para que serve |
|---|---|
| `index.html` | A plataforma inteira |
| `backend.js` | Ligação da plataforma com o Supabase |
| `config.js` | Onde você cola o endereço e a chave do Supabase |
| `supabase.sql` | Cria o banco, as permissões e o cadastro da equipe |
| `manifest.webmanifest`, `sw.js`, ícones | Permitem instalar no celular como um aplicativo |

---

## Passo 1 — Criar o banco no Supabase

1. Acesse **supabase.com** e clique em **Start your project**. Crie a conta com o GitHub ou com um e-mail.
2. Clique em **New project** e preencha:
   - **Name:** `gestao-saotech`
   - **Database password:** crie uma senha forte e guarde-a.
   - **Region:** South America (São Paulo)
3. Aguarde cerca de 2 minutos até o projeto ficar pronto.
4. No menu lateral, abra **SQL Editor** e clique em **New query**.
5. Abra o arquivo `supabase.sql`, copie todo o conteúdo, cole no editor e clique em **Run**. A mensagem esperada é "Success. No rows returned".

## Passo 2 — Criar os logins da equipe

1. No menu lateral, abra **Authentication → Users** e clique em **Add user → Create new user**.
2. Crie um usuário para cada pessoa com o e-mail abaixo e uma senha provisória. Marque **Auto Confirm User**.

| Pessoa | E-mail | Vê o Financeiro |
|---|---|---|
| Moisés Bruno | moisesbrunos@hotmail.com | sim |
| Isabella Cleto | isabellaperes2508@gmail.com | sim |
| João Marcos | joaomarcospds16@gmail.com | não |
| Moisés Júnior | moisesjuniortma@gmail.com | não |

3. Em **Authentication → Sign In / Providers → Email**, desligue a opção **Allow new users to sign up**. Assim só entra quem você cadastrar.

> Para mudar a equipe depois, abra **Table Editor → equipe**. Nessa tabela você adiciona pessoas, troca e-mails e liga ou desliga o Financeiro de cada um (coluna `admin`). Toda pessoa nova também precisa de um login criado no passo 2.

## Passo 3 — Ligar a plataforma ao seu Supabase

1. No Supabase, abra **Project Settings → API**. Em alguns painéis, o nome é **Data API** ou **API Keys**.
2. Copie a **Project URL**, que tem o formato `https://xxxx.supabase.co`.
3. Copie a chave **anon public**, também chamada de **publishable key**.
4. Abra o arquivo `config.js` num editor de texto, como o Bloco de Notas, e troque os dois textos `COLE_AQUI_...` pelos valores que você copiou. Salve o arquivo.

> A chave anon é pública por natureza: quem protege os dados são as regras do banco. Nunca use a chave **service_role**.

## Passo 4 — Publicar no GitHub Pages

1. Acesse **github.com** e crie uma conta gratuita.
2. Clique em **New repository** e preencha:
   - **Repository name:** `gestao-saotech`
   - **Visibilidade:** Public. O plano gratuito do GitHub Pages exige repositório público. O código fica visível, mas os dados não, porque continuam protegidos pelo login e pelas regras do Supabase.
3. Clique em **Create repository**. Na tela seguinte, clique em **uploading an existing file**, arraste **todos os arquivos desta pasta** e clique em **Commit changes**.
4. Abra **Settings → Pages**. Em **Source**, escolha **Deploy from a branch**, selecione **main** e **/(root)** e clique em **Save**.
5. Em 1 ou 2 minutos, o link aparece no topo da página, no formato `https://SEU-USUARIO.github.io/gestao-saotech/`.

**Alternativa sem repositório público:** use o Netlify Drop (app.netlify.com/drop), também gratuito. Basta arrastar a pasta inteira para a página e ele gera um link na hora.

## Passo 5 — Ajuste final para "Esqueci a senha"

No Supabase, abra **Authentication → URL Configuration**. Em **Site URL** e em **Redirect URLs**, cole o link da plataforma, por exemplo `https://SEU-USUARIO.github.io/gestao-saotech/`.

## Passo 6 — Instalar no celular

Abra o link no celular:

- **Android (Chrome):** menu ⋮ → **Instalar app** ou **Adicionar à tela inicial**.
- **iPhone (Safari):** botão Compartilhar → **Adicionar à Tela de Início**.

A partir daí, a plataforma abre como um aplicativo, com o ícone da Saotech.

---

## O que funciona igual e o que mudou em relação à versão no Claude

**Funciona igual:**

- quadro de demandas, checklist, conversas, anexos e histórico;
- agenda de campo, mensagens ao cliente, iniciar e finalizar dia;
- produtividade e financeiro.

**O que mudou:**

- **Login:** cada pessoa entra com o próprio e-mail e senha, e o campo "Você é" se preenche sozinho. Os administradores (Moisés e Isabella) ainda podem trocar a pessoa nesse campo para ver o painel como outro membro.
- **Google Agenda:** ao salvar um compromisso, abre o Google Agenda já preenchido e com o convite para quem vai. A pessoa só confirma em **Salvar**.

## Limites do plano gratuito do Supabase

| Recurso | Limite gratuito | O suficiente para a Saotech? |
|---|---|---|
| Banco de dados | 500 MB | Sim, anos de demandas e conversas |
| Arquivos (fotos e PDFs) | 1 GB | Cerca de 2.000 fotos de campo, que a plataforma reduz para cerca de 400 KB cada |
| Tráfego de saída | 5 GB por mês | Sim, para 4 pessoas |
| Pausa | O projeto pausa após 7 dias sem uso | Com uso diário, não pausa. Se pausar, basta reativar no painel do Supabase |

**Dica de segurança:** uma vez por mês, faça uma cópia dos dados em **Table Editor → docs → Export → CSV**.

## Hospedagem no Netlify (endereço oficial)

A plataforma fica em **https://gestaosaotech.netlify.app** (apresentação em `/apresentacao.html`).

1. No Netlify, abra o projeto **gestaosaotech** → **Project configuration → Build & deploy → Continuous deployment → Link repository**.
2. Escolha **GitHub** → repositório **gestao-saotech** → branch **main**. Deixe o comando de build em branco e o diretório de publicação como `.` (o `netlify.toml` já define isso).
3. A cada atualização enviada ao GitHub, o Netlify publica sozinho em cerca de 1 minuto.
4. No Supabase, em **Authentication → URL Configuration**, troque o **Site URL** para `https://gestaosaotech.netlify.app` e inclua o mesmo endereço em **Redirect URLs** (necessário para o "Esqueci a senha").

O endereço antigo do GitHub Pages detecta automaticamente quando o Netlify está no ar e passa a redirecionar para o endereço novo. Quem tinha ativado as notificações no endereço antigo precisa ativar de novo no novo (o navegador trata cada endereço como um app diferente).
