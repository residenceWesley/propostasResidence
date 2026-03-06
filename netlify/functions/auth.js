// netlify/functions/auth.js
// Handles: login, register, whoami (session check)

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDB, ok, err, preflight } = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err('JSON inválido'); }

  const { action } = body;
  const db = getDB();

  // ── LOGIN ─────────────────────────────────────────────────
  if (action === 'login') {
    const { name, password } = body;
    if (!name || !password) return err('Preencha todos os campos.');

    const { data: users, error } = await db
      .from('users')
      .select('id, name, password_hash, role')
      .ilike('name', name)
      .limit(1);

    if (error) return err('Erro interno.', 500);
    if (!users || users.length === 0) return err('Usuário ou senha inválidos.');

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return err('Usuário ou senha inválidos.');

    // Create session token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.from('sessions').insert({
      token,
      user_id: user.id,
      expires_at: expiresAt.toISOString(),
    });

    return ok({
      token,
      user: { id: user.id, name: user.name, role: user.role },
    });
  }

  // ── REGISTER ──────────────────────────────────────────────
  if (action === 'register') {
    const { name, password } = body;
    if (!name || !password) return err('Preencha todos os campos.');
    if (password.length < 6) return err('Senha deve ter ao menos 6 caracteres.');
    if (name.length < 2) return err('Nome muito curto.');

    // Check uniqueness (case-insensitive)
    const { data: existing } = await db
      .from('users')
      .select('id')
      .ilike('name', name)
      .limit(1);

    if (existing && existing.length > 0) return err('Esse nome de usuário já existe.');

    const password_hash = await bcrypt.hash(password, 10);
    const { data: newUser, error } = await db
      .from('users')
      .insert({ name, password_hash, role: 'broker' })
      .select('id, name, role')
      .single();

    if (error) return err('Erro ao criar conta.', 500);

    // Auto-login
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.from('sessions').insert({ token, user_id: newUser.id, expires_at: expiresAt.toISOString() });

    return ok({ token, user: { id: newUser.id, name: newUser.name, role: newUser.role } });
  }

  // ── WHOAMI (validate session token) ───────────────────────
  if (action === 'whoami') {
    const { token } = body;
    if (!token) return err('Sem token.', 401);

    const { data: sessions } = await db
      .from('sessions')
      .select('user_id, expires_at')
      .eq('token', token)
      .limit(1);

    if (!sessions || sessions.length === 0) return err('Sessão inválida.', 401);
    const session = sessions[0];
    if (new Date(session.expires_at) < new Date()) return err('Sessão expirada.', 401);

    const { data: user } = await db
      .from('users')
      .select('id, name, role')
      .eq('id', session.user_id)
      .single();

    if (!user) return err('Usuário não encontrado.', 401);
    return ok({ user });
  }

  // ── LOGOUT ────────────────────────────────────────────────
  if (action === 'logout') {
    const { token } = body;
    if (token) await db.from('sessions').delete().eq('token', token);
    return ok({ ok: true });
  }

  return err('Ação desconhecida.');
};
