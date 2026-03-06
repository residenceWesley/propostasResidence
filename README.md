# Propostas Residence — Guia de Deploy

## Arquitetura

```
Browser (HTML/CSS/JS)
      │  fetch POST /api/auth
      │  fetch POST /api/proposals
      │  fetch POST /api/users
      ▼
Netlify Functions  ← credenciais ficam aqui (env vars)
      │
      ▼
Supabase (PostgreSQL)
```

**Nenhuma credencial de banco fica no HTML.**  
O browser só conversa com as Netlify Functions, que validam cada requisição.

---

## Passo 1 — Criar o banco no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie uma conta gratuita
2. Crie um novo projeto (anote a senha do banco)
3. No menu lateral vá em **SQL Editor**
4. Cole o conteúdo de `supabase_setup.sql` e clique **Run**
5. Vá em **Settings → API** e copie:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** (secret) → `SUPABASE_SERVICE_KEY`  
     ⚠️ Nunca confunda com a `anon` key — use sempre a `service_role`

---

## Passo 2 — Publicar no Netlify

1. Suba o projeto para um repositório GitHub
2. Acesse [netlify.com](https://netlify.com) → **Add new site → Import from Git**
3. Selecione o repositório
4. Configure o build:
   - **Base directory**: deixe vazio
   - **Publish directory**: `public`
   - **Build command**: `npm install` (instala dependências das Functions)
5. Vá em **Site settings → Environment variables** e adicione:

   | Variável              | Valor                          |
   |-----------------------|--------------------------------|
   | `SUPABASE_URL`        | https://xxxx.supabase.co       |
   | `SUPABASE_SERVICE_KEY`| eyJhbGci... (service_role key) |

6. Clique **Deploy**

---

## Passo 3 — Criar a conta admin

1. Acesse o site publicado
2. Clique em **Criar conta** e cadastre o usuário `admin` com a senha desejada
3. Acesse o Supabase → **Table Editor → users**
4. Encontre o usuário `admin` e mude o campo `role` para `admin`
5. Pronto — faça login com `admin` e o sistema estará completo

---

## Estrutura de arquivos

```
residence-propostas/
├── netlify.toml                    ← configuração do Netlify
├── package.json                    ← dependências das Functions
├── supabase_setup.sql              ← script SQL para criar as tabelas
├── public/
│   └── index.html                  ← frontend completo
└── netlify/
    └── functions/
        ├── _db.js                  ← cliente Supabase (usa env vars)
        ├── auth.js                 ← login, registro, sessão
        ├── proposals.js            ← propostas e fila
        └── users.js                ← admin de usuários
```

---

## Permissões por cargo

| Ação                        | Corretor | Gerente | Admin |
|-----------------------------|----------|---------|-------|
| Ver propostas ativas        | ✅       | ✅      | ✅    |
| Criar proposta              | ✅       | ✅      | ✅    |
| Entrar na fila              | ✅       | ✅      | ✅    |
| Finalizar própria proposta  | ✅       | ✅      | ✅    |
| Derrubar proposta alheia    | ❌       | ✅      | ✅    |
| Encerrar toda a fila        | ❌       | ✅      | ✅    |
| Ver histórico próprio       | ✅       | ✅      | ✅    |
| Ver histórico de todos      | ❌       | ✅      | ✅    |
| Resetar senha de usuário    | ❌       | ✅      | ✅    |
| Promover a Gerente          | ❌       | ❌      | ✅    |

---

## Segurança

- Senhas armazenadas com **bcrypt** (hash irreversível)
- Sessões com tokens aleatórios de 32 bytes, expiram em 30 dias
- Row Level Security ativado no Supabase — acesso direto ao banco bloqueado
- A `service_role` key fica **apenas** nas variáveis de ambiente do Netlify
- O HTML não contém nenhuma credencial de banco de dados
