// netlify/functions/_db.js
// Shared Supabase client — credentials come from Netlify env vars ONLY
// Never exposed to the browser

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getDB() {
  if (!_client) {
    const url  = process.env.SUPABASE_URL;
    const key  = process.env.SUPABASE_SERVICE_KEY; // service role key — never sent to frontend
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

// CORS headers added to every response
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(data, status = 200) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(data) };
}

function err(msg, status = 400) {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

function preflight() {
  return { statusCode: 204, headers: CORS, body: '' };
}

module.exports = { getDB, ok, err, preflight, CORS };
