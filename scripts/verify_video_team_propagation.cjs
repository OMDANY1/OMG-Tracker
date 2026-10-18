const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

let envPath = path.resolve(__dirname, '../.env.local.production.bak');
if (!fs.existsSync(envPath)) envPath = path.resolve(__dirname, '../.env.local');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log("================================================================================");
  console.log("🎬 VERIFYING VIDEO TEAM PROPAGATION, ROSTER ELIGIBILITY & WORKLOAD INTEGRATION");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;
  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Workspace
  const { data: ws } = await admin.from('workspaces').select('id').limit(1).single();
  const workspaceId = ws.id;

  // 2. Query roster for video members and distinction between Hagar Hassan & Hagar Elshaer
  const { data: roster } = await admin
    .from('roster_people')
    .select('id, display_name, role, job_title, specialties, is_active')
    .eq('workspace_id', workspaceId);

  const hana = roster.find(p => p.display_name === 'هنا');
  const nour = roster.find(p => p.display_name === 'نور');
  const hagarElshaer = roster.find(p => p.display_name === 'هاجر الشاعر');
  const sayed = roster.find(p => p.display_name === 'سيد');
  const hagarHassan = roster.find(p => p.display_name === 'هاجر حسن');

  assert(hana && hana.role === 'video_editor' && hana.is_active, "Hana exists as active video_editor");
  assert(nour && nour.role === 'video_editor' && nour.is_active, "Nour exists as active video_editor");
  assert(hagarElshaer && hagarElshaer.role === 'video_editor' && hagarElshaer.is_active, "Hagar Elshaer exists as active video_editor");
  assert(sayed && sayed.role === 'video_editor' && sayed.is_active, "Sayed exists as active video_editor");
  assert(hagarHassan && hagarHassan.role === 'strategist', "Hagar Hassan is distinct strategist");
  assert(hagarElshaer && hagarHassan && hagarElshaer.id !== hagarHassan.id, "Hagar Elshaer ID is completely distinct from Hagar Hassan ID");

  // 3. Masar client team assignment
  const { data: clients } = await admin.from('clients').select('id, name, state').eq('workspace_id', workspaceId);
  const masar = clients.find(c => c.name.toLowerCase() === 'masar');
  assert(masar && masar.state === 'Active', "Client masar exists and is Active");

  const { data: assignments } = await admin.from('client_team_assignments').select('*').eq('workspace_id', workspaceId);
  const masarTeam = assignments.find(a => a.client_id === masar.id);
  assert(masarTeam && masarTeam.primary_video_editor_id === nour.id, "Masar primary_video_editor_id points directly to Nour's ID");
  assert(masarTeam && masarTeam.requires_video === true, "Masar has requires_video = true");

  // 4. Verify Workload API logic (Nour has 1 client, 0 tasks; others have 0 clients)
  const assignmentsByClientId = new Map();
  for (const a of assignments) {
    assignmentsByClientId.set(a.client_id, a);
  }

  const activeClients = clients.filter(c => c.state === 'Active');
  const getClientsForPerson = (personId) => activeClients.filter(c => {
    const t = assignmentsByClientId.get(c.id);
    if (t) {
      return (
        t.primary_designer_id === personId ||
        t.primary_copywriter_id === personId ||
        t.primary_strategist_id === personId ||
        t.primary_video_editor_id === personId ||
        c.owner_roster_id === personId
      );
    }
    return c.owner_roster_id === personId;
  });

  const nourClients = getClientsForPerson(nour.id);
  const hanaClients = getClientsForPerson(hana.id);
  const hagarElshaerClients = getClientsForPerson(hagarElshaer.id);
  const sayedClients = getClientsForPerson(sayed.id);

  assert(nourClients.length === 1 && nourClients[0].id === masar.id, `Nour has exactly 1 client (masar) [found: ${nourClients.length}]`);
  assert(hanaClients.length === 0, `Hana has 0 clients [found: ${hanaClients.length}]`);
  assert(hagarElshaerClients.length === 0, `Hagar Elshaer has 0 clients [found: ${hagarElshaerClients.length}]`);
  assert(sayedClients.length === 0, `Sayed has 0 clients [found: ${sayedClients.length}]`);

  // 5. Code assertions for static invariants
  const workloadRoute = fs.readFileSync(path.resolve(__dirname, '../app/api/team/workload/route.ts'), 'utf8');
  assert(workloadRoute.includes('.eq("state", "Active")'), "Workload API queries clients with .eq('state', 'Active')");
  assert(workloadRoute.includes('primary_video_editor_id'), "Workload API checks primary_video_editor_id");

  const clientsRoute = fs.readFileSync(path.resolve(__dirname, '../app/api/clients/route.ts'), 'utf8');
  assert(clientsRoute.includes('primary_video_editor_id'), "Clients API calculates clients across primary_video_editor_id");
  assert(clientsRoute.includes('reviewers'), "Clients API exposes authorized reviewers list");
  assert(clientsRoute.includes('hasJoined'), "Clients API computes hasJoined status");

  const clientsPage = fs.readFileSync(path.resolve(__dirname, '../app/clients/page.tsx'), 'utf8');
  assert(!clientsPage.includes("جاهزية إضافة أعضاء الفيديو الحقيقيين"), "Clients page does not show stale onboarding message");
  assert(clientsPage.includes("videoEditors.length} محررين"), "Clients page video tab shows editors count");
  assert(clientsPage.includes("videoStats.assigned} مسند"), "Clients page video tab shows assigned count");
  assert(clientsPage.includes("window.addEventListener(\"team_data_changed\""), "Clients page listens to team_data_changed");

  const teamPage = fs.readFileSync(path.resolve(__dirname, '../app/team/page.tsx'), 'utf8');
  assert(teamPage.includes("window.addEventListener(\"clients_data_changed\""), "Team page listens to clients_data_changed");

  const syncProvider = fs.readFileSync(path.resolve(__dirname, '../components/common/RealtimeSyncProvider.tsx'), 'utf8');
  assert(syncProvider.includes('client_team_assignments'), "RealtimeSyncProvider subscribes to client_team_assignments");

  console.log("================================================================================");
  console.log(`Results: ${passed} Passed | ${failed} Failed`);
  console.log("================================================================================");

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
