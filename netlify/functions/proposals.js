// netlify/functions/proposals.js
// All proposal and queue operations

const { getDB, ok, err, preflight } = require('./_db');

async function getSessionUser(db, token) {
  if (!token) return null;
  const { data: sessions } = await db
    .from('sessions').select('user_id, expires_at').eq('token', token).limit(1);
  if (!sessions || sessions.length === 0) return null;
  if (new Date(sessions[0].expires_at) < new Date()) return null;
  const { data: user } = await db.from('users').select('id, name, role').eq('id', sessions[0].user_id).single();
  return user || null;
}

// Expire queue entries older than 48h and advance the queue
async function processExpiry(db) {
  const LIMIT_MS = 48 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - LIMIT_MS).toISOString();

  // Find active queue entries that have expired
  const { data: expired } = await db
    .from('queue_entries')
    .select('id, proposal_id, broker_name, client_name, value, started_at')
    .eq('status', 'active')
    .lt('started_at', cutoff);

  if (!expired || expired.length === 0) return;

  for (const entry of expired) {
    // Mark as expired in history
    await db.from('proposal_history').insert({
      proposal_id: entry.proposal_id,
      broker_name: entry.broker_name,
      client_name: entry.client_name,
      value: entry.value,
      started_at: entry.started_at,
      ended_at: new Date().toISOString(),
      reason: 'expired',
    });

    // Remove from queue
    await db.from('queue_entries').delete().eq('id', entry.id);

    // Promote next in queue for this proposal
    const { data: next } = await db
      .from('queue_entries')
      .select('id')
      .eq('proposal_id', entry.proposal_id)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(1);

    if (next && next.length > 0) {
      await db.from('queue_entries')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', next[0].id);
    } else {
      // No more entries — mark proposal as inactive
      await db.from('proposals').update({ status: 'inactive' }).eq('id', entry.proposal_id);
    }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err('JSON inválido'); }

  const { action, token } = body;
  const db = getDB();

  const me = await getSessionUser(db, token);
  if (!me) return err('Não autorizado.', 401);

  const isPrivileged = me.role === 'admin' || me.role === 'manager';

  // Run expiry check on every request (lightweight serverless cron)
  await processExpiry(db);

  // ── LIST ACTIVE PROPOSALS ──────────────────────────────────
  if (action === 'list_active') {
    // All logged-in users see active proposals
    const { data: proposals, error } = await db
      .from('proposals')
      .select(`
        id, code, status, created_at,
        queue_entries (id, broker_name, broker_id, client_name, value, started_at, status, created_at)
      `)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) return err('Erro ao buscar propostas.', 500);

    // Sort queue entries: active first, then waiting by created_at
    const sorted = (proposals || []).map(p => ({
      ...p,
      queue_entries: (p.queue_entries || []).sort((a, b) => {
        if (a.status === 'active') return -1;
        if (b.status === 'active') return 1;
        return new Date(a.created_at) - new Date(b.created_at);
      })
    })).filter(p => p.queue_entries.length > 0);

    return ok({ proposals: sorted });
  }

  // ── LIST ALL PROPOSALS (manager/admin only) ────────────────
  if (action === 'list_all') {
    if (!isPrivileged) return err('Sem permissão.', 403);

    const { data: proposals, error } = await db
      .from('proposals')
      .select(`
        id, code, status, created_at,
        queue_entries (id, broker_name, broker_id, client_name, value, started_at, status, created_at)
      `)
      .order('created_at', { ascending: false });

    if (error) return err('Erro ao buscar propostas.', 500);

    const sorted = (proposals || []).map(p => ({
      ...p,
      queue_entries: (p.queue_entries || []).sort((a, b) => {
        if (a.status === 'active') return -1;
        if (b.status === 'active') return 1;
        return new Date(a.created_at) - new Date(b.created_at);
      })
    }));

    return ok({ proposals: sorted });
  }

  // ── HISTORY ───────────────────────────────────────────────
  if (action === 'list_history') {
    // Brokers see only their own history; managers/admin see all
    let query = db
      .from('proposal_history')
      .select('id, proposal_id, broker_name, client_name, value, started_at, ended_at, reason, proposals(code)')
      .order('ended_at', { ascending: false })
      .limit(200);

    if (!isPrivileged) {
      query = query.eq('broker_id', me.id);
    }

    const { data: history, error } = await query;
    if (error) return err('Erro ao buscar histórico.', 500);
    return ok({ history: history || [] });
  }

  // ── ADD PROPOSAL / JOIN QUEUE ─────────────────────────────
  if (action === 'add') {
    const { code, client, value } = body;
    if (!code || !client || !value) return err('Preencha todos os campos.');

    // Validate code format
    if (!/^[A-Z]{2}\d{4}_RESI$/.test(code)) return err('Código inválido.');
    if (value <= 0) return err('Valor inválido.');

    // Check if proposal exists for this code
    const { data: existing } = await db
      .from('proposals')
      .select('id, status')
      .eq('code', code)
      .limit(1);

    let proposalId;

    if (existing && existing.length > 0) {
      const prop = existing[0];
      proposalId = prop.id;

      // If inactive, reactivate
      if (prop.status === 'inactive') {
        await db.from('proposals').update({ status: 'active' }).eq('id', prop.id);
      }

      // Check if there's already an active entry for this broker on this proposal
      const { data: myActive } = await db
        .from('queue_entries')
        .select('id')
        .eq('proposal_id', prop.id)
        .eq('broker_id', me.id)
        .in('status', ['active', 'waiting']);

      if (myActive && myActive.length > 0) return err('Você já tem uma proposta nessa fila.');
    } else {
      // Create new proposal
      const { data: newProp, error: pe } = await db
        .from('proposals')
        .insert({ code, status: 'active' })
        .select('id')
        .single();
      if (pe) return err('Erro ao criar proposta.', 500);
      proposalId = newProp.id;
    }

    // Is there already an active entry for this proposal?
    const { data: activeEntries } = await db
      .from('queue_entries')
      .select('id')
      .eq('proposal_id', proposalId)
      .eq('status', 'active');

    const hasActive = activeEntries && activeEntries.length > 0;

    const { error: qe } = await db.from('queue_entries').insert({
      proposal_id: proposalId,
      broker_id: me.id,
      broker_name: me.name,
      client_name: client,
      value: parseFloat(value),
      status: hasActive ? 'waiting' : 'active',
      started_at: hasActive ? null : new Date().toISOString(),
    });

    if (qe) return err('Erro ao adicionar na fila.', 500);
    return ok({ ok: true, reactivated: !!(existing && existing[0]?.status === 'inactive') });
  }

  // ── FINALIZE (current or all) ─────────────────────────────
  if (action === 'finalize') {
    const { proposalId, scope } = body; // scope: 'current' | 'all'

    // Get the proposal
    const { data: prop } = await db.from('proposals').select('id, code').eq('id', proposalId).single();
    if (!prop) return err('Proposta não encontrada.');

    // Get current active entry
    const { data: entries } = await db
      .from('queue_entries')
      .select('id, broker_id, broker_name, client_name, value, started_at, status, created_at')
      .eq('proposal_id', proposalId)
      .order('created_at', { ascending: true });

    if (!entries || entries.length === 0) return err('Nenhuma proposta na fila.');

    const active = entries.find(e => e.status === 'active');
    const waiting = entries.filter(e => e.status === 'waiting');

    // Permission check
    const canFinalizeCurrent = isPrivileged || (active && active.broker_id === me.id);
    if (!canFinalizeCurrent) return err('Sem permissão.', 403);
    if (scope === 'all' && !isPrivileged) return err('Sem permissão.', 403);

    const now = new Date().toISOString();

    if (scope === 'all') {
      // Finalize all entries
      for (const e of entries) {
        await db.from('proposal_history').insert({
          proposal_id: proposalId,
          broker_id: e.broker_id,
          broker_name: e.broker_name,
          client_name: e.client_name,
          value: e.value,
          started_at: e.started_at || e.created_at,
          ended_at: now,
          reason: 'finalized',
        });
      }
      await db.from('queue_entries').delete().eq('proposal_id', proposalId);
      await db.from('proposals').update({ status: 'inactive' }).eq('id', proposalId);
    } else {
      // Finalize only active
      if (active) {
        await db.from('proposal_history').insert({
          proposal_id: proposalId,
          broker_id: active.broker_id,
          broker_name: active.broker_name,
          client_name: active.client_name,
          value: active.value,
          started_at: active.started_at,
          ended_at: now,
          reason: 'finalized',
        });
        await db.from('queue_entries').delete().eq('id', active.id);
      }

      // Promote next
      if (waiting.length > 0) {
        const next = waiting[0];
        await db.from('queue_entries')
          .update({ status: 'active', started_at: now })
          .eq('id', next.id);
      } else {
        await db.from('proposals').update({ status: 'inactive' }).eq('id', proposalId);
      }
    }

    return ok({ ok: true });
  }

  return err('Ação desconhecida.');
};
