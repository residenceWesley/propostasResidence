// netlify/functions/keepalive.js
// Função agendada — executa automaticamente a cada 5 dias
// Faz uma query simples no Supabase para manter o projeto ativo
// e evitar a pausa por inatividade da conta gratuita.
//
// O agendamento é definido no netlify.toml:
//   [functions."keepalive"]
//   schedule = "@every 5 days"  (equivale a: 0 0 */5 * *)

const { getDB, ok, err } = require('./_db');

exports.handler = async (event) => {
  const startedAt = new Date().toISOString();
  console.log(`[keepalive] Iniciando ping ao Supabase — ${startedAt}`);

  try {
    const db = getDB();

    // Query leve: conta quantos usuários existem
    // Não lê dados sensíveis, apenas verifica conectividade
    const { count, error } = await db
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) throw new Error(error.message);

    const msg = `[keepalive] Supabase ativo — ${count} usuário(s) registrado(s) — ${new Date().toISOString()}`;
    console.log(msg);
    return ok({ status: 'alive', users: count, timestamp: new Date().toISOString() });

  } catch (e) {
    console.error('[keepalive] ERRO ao contatar Supabase:', e.message);
    return err('Keepalive falhou: ' + e.message, 500);
  }
};
