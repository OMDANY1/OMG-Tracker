const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  console.log("=== TESTING EXACT CLIENT QUERY FROM app/api/clients/route.ts ===");
  const { data: rawClients, error } = await admin
    .from("clients")
    .select(`
      *,
      owner:roster_people!fk_client_owner(id, display_name, job_title),
      campaigns(id, title, status),
      tasks(id, status, primary_assignee_id, work_stage),
      team_assignment:client_team_assignments(
        *,
        primary_strategist:roster_people!client_team_assignments_primary_strategist_id_fkey(id, display_name, job_title),
        primary_copywriter:roster_people!client_team_assignments_primary_copywriter_id_fkey(id, display_name, job_title),
        primary_designer:roster_people!client_team_assignments_primary_designer_id_fkey(id, display_name, job_title),
        primary_video_editor:roster_people!client_team_assignments_primary_video_editor_id_fkey(id, display_name, job_title),
        strategy_reviewer:roster_people!client_team_assignments_strategy_reviewer_id_fkey(id, display_name, job_title),
        copywriting_reviewer:roster_people!client_team_assignments_copywriting_reviewer_id_fkey(id, display_name, job_title),
        design_reviewer:roster_people!client_team_assignments_design_reviewer_id_fkey(id, display_name, job_title),
        video_reviewer:roster_people!client_team_assignments_video_reviewer_id_fkey(id, display_name, job_title),
        marketing_director:roster_people!client_team_assignments_marketing_director_id_fkey(id, display_name, job_title),
        strategy_lead:roster_people!client_team_assignments_strategy_lead_id_fkey(id, display_name, job_title)
      ),
      brief_data:client_briefs(*)
    `)
    .order("name", { ascending: true });

  if (error) {
    console.error("Query Error:", error);
  } else {
    console.log(`Success! Fetched ${rawClients.length} clients:`);
    console.log(JSON.stringify(rawClients, null, 2));
  }
}

main().catch(console.error).finally(() => process.exit(0));
