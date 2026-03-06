-- ══════════════════════════════════════════════════════
-- PROPOSTAS RESIDENCE — Supabase Database Setup
-- Execute este script no SQL Editor do Supabase
-- ══════════════════════════════════════════════════════

-- 1. USERS
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  password_hash text not null,
  role          text not null default 'broker' check (role in ('admin','manager','broker')),
  created_at    timestamptz default now()
);

-- 2. SESSIONS (tokens de autenticação)
create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  token      text not null unique,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create index if not exists sessions_token_idx on sessions(token);
create index if not exists sessions_user_idx  on sessions(user_id);

-- 3. PROPOSALS
create table if not exists proposals (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,           -- ex: CA0175_RESI
  status     text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz default now()
);
create index if not exists proposals_code_idx   on proposals(code);
create index if not exists proposals_status_idx on proposals(status);

-- 4. QUEUE ENTRIES
create table if not exists queue_entries (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  broker_id   uuid not null references users(id),
  broker_name text not null,
  client_name text not null,
  value       numeric(12,2) not null,
  status      text not null default 'waiting' check (status in ('active','waiting')),
  started_at  timestamptz,            -- set when status becomes 'active'
  created_at  timestamptz default now()
);
create index if not exists queue_proposal_idx on queue_entries(proposal_id);
create index if not exists queue_status_idx   on queue_entries(status);

-- 5. PROPOSAL HISTORY
create table if not exists proposal_history (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid references proposals(id),
  broker_id   uuid references users(id),
  broker_name text not null,
  client_name text,
  value       numeric(12,2) not null,
  started_at  timestamptz,
  ended_at    timestamptz default now(),
  reason      text not null check (reason in ('expired','finalized'))
);
create index if not exists history_proposal_idx on proposal_history(proposal_id);
create index if not exists history_broker_idx   on proposal_history(broker_id);

-- ══════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — bloqueia acesso direto ao banco
-- As Netlify Functions usam a SERVICE KEY que bypassa o RLS.
-- Nenhuma chave de cliente é exposta no HTML.
-- ══════════════════════════════════════════════════════
alter table users             enable row level security;
alter table sessions          enable row level security;
alter table proposals         enable row level security;
alter table queue_entries     enable row level security;
alter table proposal_history  enable row level security;

-- Sem policies públicas = ninguém acessa diretamente pelo browser.
-- Apenas a SERVICE KEY (usada nas Functions) pode ler/escrever.

-- ══════════════════════════════════════════════════════
-- ADMIN PADRÃO
-- Troque 'SUA_SENHA_AQUI' pela senha desejada ANTES de rodar.
-- O hash abaixo é gerado pelo bcrypt (cost 10).
-- Para gerar: https://bcrypt-generator.com/ (10 rounds)
-- ══════════════════════════════════════════════════════
-- insert into users (name, password_hash, role)
-- values ('admin', '$2a$10$SEU_HASH_AQUI', 'admin')
-- on conflict (name) do nothing;

-- Ou rode este INSERT com a senha em texto puro via Netlify Function
-- após o deploy (a função de registro cria o hash automaticamente).
-- Basta criar a conta 'admin' pelo formulário de registro e depois
-- promovê-la manualmente no Supabase Table Editor:
--   UPDATE users SET role = 'admin' WHERE name = 'admin';
