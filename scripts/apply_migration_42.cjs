const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

let envPath = path.resolve(__dirname, '../.env.local.production.bak');
if (!fs.existsSync(envPath)) envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

async function main() {
  const connectionString = env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.log("No direct database connection string, let's check keys:", Object.keys(env));
    return;
  }
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to Postgres successfully!");

  const migrationSql = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20260927000042_harden_admin_update_roster_person.sql'), 'utf8');
  await client.query(migrationSql);
  console.log("Migration 42 applied successfully!");
  await client.end();
}

main().catch(console.error).finally(() => process.exit(0));
