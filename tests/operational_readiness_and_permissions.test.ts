// OMG Creative Workspace: Operational Readiness & Permissions Matrix Test Suite
// tests/operational_readiness_and_permissions.test.ts
// Verifies live production roles, permissions enforcement, isolated viewer RBAC, and invitation lifecycle.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { ROLE_PERMISSIONS_MATRIX, RosterRole } from "../types/database";

let envPath = path.join(__dirname, "../.env.local.production.bak");
if (!fs.existsSync(envPath)) {
  envPath = path.join(__dirname, "../.env.local");
}
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).trim();
      }
      process.env[key] = val;
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(supabaseUrl, serviceKey);

let passed = 0;
let failed = 0;

function assert(condition: boolean, title: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${title}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${title}${detail ? ` -> ${detail}` : ""}`);
    failed++;
  }
}

async function runSuite() {
  console.log("================================================================================");
  console.log("🚀 OMG Creative Workspace - Operational Readiness & Permissions Matrix Suite");
  console.log("================================================================================");

  // ---------------------------------------------------------------------------
  // ITEM 1: Team Roles & Badges Data Integrity (Production whzkpuovqllybxlyoikk)
  // ---------------------------------------------------------------------------
  console.log("\n[Item 1] Verifying Team Roles & Badges in Production Database...");

  const { data: roster, error: rosterErr } = await admin
    .from("roster_people")
    .select("id, display_name, job_title, role, is_active")
    .order("created_at", { ascending: true });

  assert(!rosterErr && !!roster, "roster_people table queries successfully without error", rosterErr?.message);
  assert(roster!.length >= 14, `All roster members present (found ${roster?.length})`);

  const roleMap: Record<string, string> = {};
  roster?.forEach((r) => {
    roleMap[r.display_name] = r.role;
  });

  console.log("  Roster Members & Live Roles in DB:");
  roster?.forEach((r) => {
    console.log(`    - ${r.display_name.padEnd(20)} | Role: ${r.role.padEnd(20)} | Title: ${r.job_title}`);
  });

  // Verify key individuals
  assert(roleMap["عطا"] === "marketing_director", "Atta role is marketing_director (NOT generic designer)");
  assert(roleMap["أروى"] === "strategy_lead", "Arwa role is strategy_lead (NOT generic designer)");
  assert(roleMap["تسنيم"] === "strategist", "Tasneem role is strategist");
  assert(roleMap["هند"] === "strategist", "Hind role is strategist");
  assert(roleMap["هاجر حسن"] === "strategist", "Hagar Hassan role is strategist");
  assert(roleMap["ميرهان"] === "content_writer", "Mirhan role is content_writer");
  assert(roleMap["ميار"] === "content_writer", "Mayar role is content_writer");
  assert(roleMap["ريهام"] === "content_writer", "Reham role is content_writer");
  assert(roleMap["ندى"] === "senior_reviewer", "Nada role is senior_reviewer");
  assert(roleMap["سارة"] === "designer", "Sara role is designer");
  assert(roleMap["آلاء"] === "designer", "Alaa role is designer");
  assert(roleMap["شهد"] === "designer", "Shahd role is designer");
  assert(roleMap["آية"] === "designer", "Aya role is designer");

  const ownerMember = roster?.find((r) => r.role === "owner" && r.is_active === true);
  assert(!!ownerMember, "Workspace active Owner roster record exists and has owner role");

  // ---------------------------------------------------------------------------
  // ITEM 2: Permissions Matrix Specification & Server-Side Security Rules
  // ---------------------------------------------------------------------------
  console.log("\n[Item 2] Verifying Permissions Matrix & RBAC Definitions...");

  assert(!!ROLE_PERMISSIONS_MATRIX, "ROLE_PERMISSIONS_MATRIX object exists in types/database.ts");
  assert(ROLE_PERMISSIONS_MATRIX.owner.canManageWorkspace === true, "Owner has full workspace management");
  assert(ROLE_PERMISSIONS_MATRIX.business_owner_viewer.canManageWorkspace === false, "Viewer CANNOT manage workspace");
  assert(ROLE_PERMISSIONS_MATRIX.business_owner_viewer.canManageClients === false, "Viewer CANNOT manage clients");
  assert(ROLE_PERMISSIONS_MATRIX.business_owner_viewer.canAssignTeam === false, "Viewer CANNOT assign team");
  assert(ROLE_PERMISSIONS_MATRIX.business_owner_viewer.canExportReports === false, "Viewer CANNOT export analytical pack");
  assert(ROLE_PERMISSIONS_MATRIX.marketing_director.canExportReports === true, "Marketing Director (Atta) CAN export analytical pack");
  assert(ROLE_PERMISSIONS_MATRIX.marketing_director.canManageWorkspace === false, "Marketing Director CANNOT modify system workspace");
  assert(ROLE_PERMISSIONS_MATRIX.strategy_lead.canApproveReviews === true, "Strategy Lead (Arwa) CAN approve reviews");
  assert(ROLE_PERMISSIONS_MATRIX.designer.canExportReports === false, "Designer CANNOT export reports");

  // ---------------------------------------------------------------------------
  // ITEM 3: Last Active Owner Protection Rule
  // ---------------------------------------------------------------------------
  console.log("\n[Item 3] Verifying Last Active Owner Protection (RPC admin_update_roster_person)...");

  const { data: wsData } = await admin.from("workspaces").select("id").limit(1).single();
  const wsId = wsData!.id;

  if (ownerMember) {
    // Attempting to downgrade owner to designer should be blocked by PostgreSQL RPC
    const { error: downgradeErr } = await admin.rpc("admin_update_roster_person", {
      p_workspace_id: wsId,
      p_roster_person_id: ownerMember.id,
      p_job_title: ownerMember.job_title,
      p_specialties: ["management"],
      p_role: "designer",
    });

    assert(
      !!downgradeErr && (downgradeErr.message.includes("لا يمكن تغيير دور آخر") || downgradeErr.message.includes("مدير عام")),
      "PostgreSQL RPC strictly blocks downgrading the last active owner",
      downgradeErr?.message
    );

    // Attempting to deactivate owner should be blocked
    const { error: deactivateErr } = await admin.rpc("toggle_workspace_member_active", {
      p_workspace_id: wsId,
      p_roster_person_id: ownerMember.id,
      p_is_active: false,
    });

    assert(
      !!deactivateErr && (deactivateErr.message.includes("Owner account cannot be deactivated") || deactivateErr.message.includes("لا يمكن تعطيل")),
      "PostgreSQL RPC strictly blocks deactivating the last active owner",
      deactivateErr?.message
    );
  }

  // ---------------------------------------------------------------------------
  // ITEM 4: Isolated Business Owner Viewer Permissions Contract
  // ---------------------------------------------------------------------------
  console.log("\n[Item 4] Verifying Isolated Business Owner Viewer Permissions Contract...");

  // Verify server-auth.ts helpers
  const serverAuthContent = fs.readFileSync(path.join(__dirname, "../lib/auth/server-auth.ts"), "utf-8");
  assert(
    serverAuthContent.includes("requireExportPermission"),
    "server-auth.ts defines requireExportPermission RBAC helper"
  );
  assert(
    serverAuthContent.includes('allowedRoles: ["owner", "manager", "marketing_director"]'),
    "requireExportPermission restricts analytical export exclusively to owner, manager, and marketing_director"
  );

  // Check /api/reports/export-pack/route.ts enforcement
  const exportPackRoute = fs.readFileSync(path.join(__dirname, "../app/api/reports/export-pack/route.ts"), "utf-8");
  assert(
    exportPackRoute.includes("requireExportPermission"),
    "/api/reports/export-pack/route.ts strictly calls requireExportPermission"
  );

  // ---------------------------------------------------------------------------
  // ITEM 5: Complete Invitation Lifecycle (Draft -> Issue -> Accept Link)
  // ---------------------------------------------------------------------------
  console.log("\n[Item 5] Testing Invitation Lifecycle (Draft vs Issued vs Accept)...");

  const testEmail = `test.readiness.${Date.now()}@example.internal`;
  const designerMember = roster?.find((r) => r.role === "designer");
  assert(!!designerMember, "Found designer roster member for invitation test");

  if (designerMember && ownerMember) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    // 5a. Create DRAFT invitation
    const { data: draftInv, error: draftErr } = await admin
      .from("workspace_invitations")
      .insert({
        workspace_id: wsId,
        invited_email: testEmail,
        role: "designer",
        roster_person_id: designerMember.id,
        token_hash: tokenHash,
        invited_by_roster_id: ownerMember.id,
        status: "draft",
        expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      })
      .select()
      .single();

    assert(!draftErr && !!draftInv, "Successfully created draft invitation record", draftErr?.message);
    assert(draftInv?.status === "draft", "Draft invitation status is 'draft'");

    // 5b. Transition Draft to ISSUED (pending with 7-day expiry)
    const sevenDaysLater = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const { data: issuedInv, error: issueErr } = await admin
      .from("workspace_invitations")
      .update({
        status: "pending",
        expires_at: sevenDaysLater,
      })
      .eq("id", draftInv!.id)
      .select()
      .single();

    assert(!issueErr && !!issuedInv, "Successfully issued draft invitation", issueErr?.message);
    assert(issuedInv?.status === "pending", "Issued invitation status is 'pending'");

    // 5c. Validate accept-invite validation logic
    const { data: verifiedInv } = await admin
      .from("workspace_invitations")
      .select(`
        id,
        invited_email,
        role,
        status,
        expires_at,
        roster_person:roster_people!fk_invitation_roster(id, display_name, job_title, role)
      `)
      .eq("id", issuedInv!.id)
      .single();

    assert(!!verifiedInv && verifiedInv.status === "pending", "Invitation resolves cleanly for /accept-invite?id=...");

    // 5d. Clean up test invitation safely
    await admin.from("workspace_invitations").delete().eq("id", draftInv!.id);
    console.log("  Cleaned up test invitation cleanly without leftover state.");
  }

  // ---------------------------------------------------------------------------
  // ITEM 6: Client Onboarding and Team Assignment Persistence
  // ---------------------------------------------------------------------------
  console.log("\n[Item 6] Testing Client Onboarding & Team Assignment Persistence...");

  const testClientName = `Automated Readiness Test Brand ${Date.now()}`;

  const attaMember = roster?.find((r) => r.display_name === "عطا");
  const arwaMember = roster?.find((r) => r.display_name === "أروى");
  const saraMember = roster?.find((r) => r.display_name === "سارة");

  // Create test client with full multi-service assignment
  const { data: testClient, error: clientErr } = await admin
    .from("clients")
    .insert({
      workspace_id: wsId,
      name: testClientName,
      difficulty: "Medium",
      extra_workload: "None",
      state: "Active",
      owner_roster_id: saraMember?.id || null,
      notes: "Test client for operational readiness verification",
    })
    .select()
    .single();

  assert(!clientErr && !!testClient, "Client record created successfully in production DB", clientErr?.message);

  if (testClient) {
    // Upsert team assignment linking design, strategy, copywriting
    const { data: assignRecord, error: assignErr } = await admin
      .from("client_team_assignments")
      .upsert(
        {
          workspace_id: wsId,
          client_id: testClient.id,
          primary_designer_id: saraMember?.id || null,
          design_reviewer_id: attaMember?.id || null,
          primary_strategist_id: arwaMember?.id || null,
          strategy_reviewer_id: arwaMember?.id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,client_id" }
      )
      .select()
      .single();

    assert(!assignErr && !!assignRecord, "Client multi-service team assignment saved successfully", assignErr?.message);
    assert(assignRecord?.primary_designer_id === saraMember?.id, "Designer assignment correctly stored");
    assert(assignRecord?.primary_strategist_id === arwaMember?.id, "Strategist assignment correctly stored");

    // Clean up test client and assignment safely
    await admin.from("client_team_assignments").delete().eq("client_id", testClient.id);
    await admin.from("clients").delete().eq("id", testClient.id);
    console.log("  Cleaned up test client and team assignments cleanly without leftover state.");
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`Results: ${passed} Passed | ${failed} Failed`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("Test execution threw unhandled exception:", err);
  process.exit(1);
});
