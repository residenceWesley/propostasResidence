// netlify/functions/users.js
// Admin/manager operations on users

const bcrypt = require('bcryptjs');
const { getDB, ok, err, preflight } = require('./_db');

// Validate session and return user, or null
async function getSessionUser(db, token) {
  if (!token) return null;
  const { data: sessions } = await db
    .from('sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .limit(1);
  if (!sessions || sessions.length === 0) return null;
  if (new Date(sessions[0].expires_at) < new Date()) return null;
  const { data: user } = await db.from('users').select('id, name, role').eq('id', sessions[0].user_id).single();
  return user || null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err('JSON inválido'); }

  const { action, token } = body;
  const db = getDB();

  const me = await getSessionUser(db, token);
  if (!me) return err('Não autorizado.', 401);

  // ── LIST USERS (admin only) ────────────────────────────────
  if (action === 'list') {
    if (me.role !== 'admin' && me.role !== 'manager') return err('Sem permissão.', 403);
    const { data: users, error } = await db
      .from('users')
      .select('id, name, role')
      .neq('role', 'admin')
      .order('name');
    if (error) return err('Erro ao buscar usuários.', 500);
    return ok({ users });
  }

  // ── CHANGE ROLE (admin only) ───────────────────────────────
  if (action === 'set_role') {
    if (me.role !== 'admin') return err('Sem permissão.', 403);
    const { userId, role } = body;
    if (!['broker', 'manager'].includes(role)) return err('Cargo inválido.');
    const { error } = await db.from('users').update({ role }).eq('id', userId).neq('role', 'admin');
    if (error) return err('Erro ao atualizar cargo.', 500);
    return ok({ ok: true });
  }

  // ── RESET PASSWORD (admin or manager) ─────────────────────
  if (action === 'reset_password') {
    if (me.role !== 'admin' && me.role !== 'manager') return err('Sem permissão.', 403);
    const { userId, newPassword } = body;
    if (!newPassword || newPassword.length < 6) return err('Senha deve ter ao menos 6 caracteres.');

    // Managers cannot reset admin passwords
    const { data: target } = await db.from('users').select('role').eq('id', userId).single();
    if (!target) return err('Usuário não encontrado.');
    if (target.role === 'admin' && me.role !== 'admin') return err('Sem permissão.', 403);

    const password_hash = await bcrypt.hash(newPassword, 10);
    const { error } = await db.from('users').update({ password_hash }).eq('id', userId);
    if (error) return err('Erro ao redefinir senha.', 500);

    // Invalidate all sessions for that user
    await db.from('sessions').delete().eq('user_id', userId);

    return ok({ ok: true });
  }

  return err('Ação desconhecida.');
};
