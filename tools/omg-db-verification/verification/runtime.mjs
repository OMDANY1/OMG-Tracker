import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function runtime() {
  const db = new PGlite({extensions:{btree_gist,pgcrypto}});
  // These are TEST prerequisites, not a Supabase Auth/Storage server.
  // SQL engine, roles, ACLs, constraints and RLS execute inside real Postgres WASM.
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA extensions;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean DEFAULT false,
      file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text REFERENCES storage.buckets(id), name text NOT NULL, owner_id text,
      UNIQUE(bucket_id,name));
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA storage TO authenticated,service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
    -- Exercise hardening even when a hosted project's defaults expose new objects.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
    CREATE SCHEMA IF NOT EXISTS cron;
    CREATE TABLE IF NOT EXISTS cron.job (jobid BIGSERIAL PRIMARY KEY, jobname TEXT UNIQUE, schedule TEXT, command TEXT, active BOOLEAN DEFAULT true);
    CREATE OR REPLACE FUNCTION cron.schedule(name text, sched text, cmd text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
    CREATE OR REPLACE FUNCTION cron.unschedule(name text) RETURNS void LANGUAGE sql AS 'SELECT';
    CREATE SCHEMA IF NOT EXISTS net;
    CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
    CREATE SCHEMA IF NOT EXISTS vault;
    CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT UNIQUE, decrypted_secret TEXT);
    GRANT USAGE ON SCHEMA cron, net, vault TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA cron, net, vault TO authenticated, service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA cron, net, vault TO authenticated, service_role;
    SET search_path = public, extensions;
  `);
  return db;
}
export async function migrations(db, directory='migrations', report=console.log) {
  for (const file of (await readdir(resolve(root,directory))).filter(x=>x.endsWith('.sql')).sort()) {
    try {
      let sql = await readFile(resolve(root,directory,file),'utf8');
      if (sql.charCodeAt(0) === 0xFEFF) sql = sql.slice(1);
      // Stub out extensions not available in WASM
      sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pg_cron;/g, 'CREATE SCHEMA IF NOT EXISTS cron;')
               .replace(/CREATE EXTENSION IF NOT EXISTS pg_net;/g, 'CREATE SCHEMA IF NOT EXISTS net;')
               .replace(/CREATE EXTENSION IF NOT EXISTS supabase_vault;/g, 'CREATE SCHEMA IF NOT EXISTS vault;');
      await db.exec(sql);
      report(`COMMITTED ${file}`);
    }
    catch(e) { report(`FAILED ${file}: ${e.code}: ${e.message}`); throw e; }
  }
}
