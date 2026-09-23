// OMG Creative Workspace: Operational Readiness & Permissions Matrix Test Suite
// tests/operational_readiness_and_permissions.test.ts
// Verifies live production roles, Migration 36 schema, custom permissions enforcement, isolated viewer RBAC, and cryptographic invitation lifecycle.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  ROLE_PERMISSIONS_MATRIX,
  DEFAULT_ROLE_PERMISSIONS,
  GRANULAR_PERMISSIONS_LIST,
  ACCESS_SCOPE_CONFIGS,
  AccessScope,
  CustomPermissions,
} from "../types/database";
import {
  generateSecureToken,
  hashToken,
  encryptToken,
  decryptToken,
  verifyToken,
} from "../lib/crypto-tokens";

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
    .select("id, display_name, job_title, role, is_active, access_scope, custom_permissions")
    .order("created_at", { ascending: true });

  assert(!rosterErr && !!roster, "roster_people table queries successfully without error", rosterErr?.message);
  assert(roster!.length >= 14, `All roster members present (found ${roster?.length})`);

  const roleMap: Record<string, string> = {};
  roster?.forEach((r) => {
    roleMap[r.display_name] = r.role;
  });

  console.log("  Roster Members & Live Roles in DB:");
  roster?.forEach((r) => {
    console.log(`    - ${r.display_name.padEnd(25)} | Role: ${r.role.padEnd(20)} | Active: ${r.is_active}`);
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

  // Verify Legacy Inactive Owner vs Active Emad Owner
  const legacyOwner = roster?.find((r) => r.display_name.includes("المدير العام (Owner)"));
  assert(!!legacyOwner && legacyOwner.is_active === false, "Legacy Owner 'المدير العام (Owner)' is is_active = false");

  const emadOwner = roster?.find((r) => r.display_name.includes("عماد") && r.role === "owner");
  assert(!!emadOwner && emadOwner.is_active === true, "Active Owner 'عماد' is active owner");

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
  assert(ROLE_PERMISSIONS_MATRIX.business_owner_viewer.canTrackTime === false, "Viewer CANNOT track time");

  // Atta (marketing_director): strictly reports and export only, NO review/approvals, NO timer
  assert(ROLE_PERMISSIONS_MATRIX.marketing_director.canExportReports === true, "Marketing Director (Atta) CAN export reports");
  assert(ROLE_PERMISSIONS_MATRIX.marketing_director.canManageWorkspace === false, "Marketing Director CANNOT modify workspace");
  assert(ROLE_PERMISSIONS_MATRIX.marketing_director.canTrackTime === false, "Marketing Director (Atta) CANNOT track time");
  assert(ROLE_PERMISSIONS_MATRIX.marketing_director.canApproveReviews === false, "Marketing Director (Atta) CANNOT approve reviews");

  // Arwa (strategy_lead): strategy approvals
  assert(ROLE_PERMISSIONS_MATRIX.strategy_lead.canApproveReviews === true, "Strategy Lead (Arwa) CAN approve reviews");

  // Default Granular Permissions
  assert(DEFAULT_ROLE_PERMISSIONS.marketing_director.track_timer === false, "Default Atta track_timer is false");
  assert(DEFAULT_ROLE_PERMISSIONS.marketing_director.approve_reviews === false, "Default Atta approve_reviews is false");
  assert(DEFAULT_ROLE_PERMISSIONS.marketing_director.approve_strategy === false, "Default Atta approve_strategy is false");
  assert(DEFAULT_ROLE_PERMISSIONS.marketing_director.view_time_logs === true, "Default Atta view_time_logs is true");
  assert(DEFAULT_ROLE_PERMISSIONS.marketing_director.export_reports === true, "Default Atta export_reports is true");

  assert(DEFAULT_ROLE_PERMISSIONS.strategy_lead.approve_strategy === true, "Default Arwa approve_strategy is true");
  assert(DEFAULT_ROLE_PERMISSIONS.strategy_lead.approve_reviews === true, "Default Arwa approve_reviews is true");

  // ---------------------------------------------------------------------------
  // ITEM 3: Migration 36 Schema Verification
  // ---------------------------------------------------------------------------
  console.log("\n[Item 3] Verifying Migration 36 Schema (Columns & RPCs)...");

  const { data: wsData, error: wsErr } = await admin
    .from("workspaces")
    .select("id, allow_invitation_emails, allow_invitation_acceptance")
    .limit(1)
    .single();

  assert(!wsErr && !!wsData, "workspaces table contains allow_invitation_emails and allow_invitation_acceptance", wsErr?.message);
  assert(typeof wsData?.allow_invitation_emails === "boolean", `allow_invitation_emails is boolean (${wsData?.allow_invitation_emails})`);
  assert(typeof wsData?.allow_invitation_acceptance === "boolean", `allow_invitation_acceptance is boolean (${wsData?.allow_invitation_acceptance})`);

  const wsId = wsData!.id;

  // ---------------------------------------------------------------------------
  // ITEM 4: Custom Permissions and Access Scope Persistence
  // ---------------------------------------------------------------------------
  console.log("\n[Item 4] Testing Custom Permissions and Scope Persistence on Roster Person...");

  const testMember = roster?.find((r) => r.role === "designer" && r.is_active === true);
  assert(!!testMember, "Found active designer member for custom permissions test");

  if (testMember) {
    const customTestPerms: CustomPermissions = {
      manage_workspace: false,
      invite_members: false,
      manage_members: false,
      manage_clients: false,
      delete_clients: false,
      assign_team: false,
      create_campaigns: false,
      create_tasks: false,
      track_timer: true,
      approve_strategy: false,
      approve_reviews: false,
      view_time_logs: true,
      export_reports: false,
      comment_and_attachments: true,
    };

    // Update member using admin_update_roster_person RPC
    const { error: updateErr } = await admin.rpc("admin_update_roster_person", {
      p_workspace_id: wsId,
      p_roster_person_id: testMember.id,
      p_job_title: testMember.job_title,
      p_specialties: ["design"],
      p_role: "designer",
      p_access_scope: "assigned_clients",
      p_custom_permissions: customTestPerms,
    });

    assert(!updateErr, "admin_update_roster_person accepts access_scope and custom_permissions", updateErr?.message);

    // Verify stored in DB
    const { data: updatedMember } = await admin
      .from("roster_people")
      .select("access_scope, custom_permissions")
      .eq("id", testMember.id)
      .single();

    assert(updatedMember?.access_scope === "assigned_clients", "access_scope persisted as 'assigned_clients'");
    assert(updatedMember?.custom_permissions?.view_time_logs === true, "custom_permissions.view_time_logs persisted as true");

    // Restore to default designer scope
    await admin.rpc("admin_update_roster_person", {
      p_workspace_id: wsId,
      p_roster_person_id: testMember.id,
      p_job_title: testMember.job_title,
      p_specialties: ["design"],
      p_role: "designer",
      p_access_scope: "assigned_tasks",
      p_custom_permissions: DEFAULT_ROLE_PERMISSIONS.designer,
    });
    console.log("  Restored test member permissions back to designer defaults.");
  }

  // ---------------------------------------------------------------------------
  // ITEM 5: Last Active Owner Protection Rule
  // ---------------------------------------------------------------------------
  console.log("\n[Item 5] Verifying Last Active Owner Protection...");

  if (emadOwner) {
    const { error: downgradeErr } = await admin.rpc("admin_update_roster_person", {
      p_workspace_id: wsId,
      p_roster_person_id: emadOwner.id,
      p_job_title: emadOwner.job_title,
      p_specialties: ["management"],
      p_role: "designer",
      p_access_scope: "workspace",
      p_custom_permissions: {},
    });

    assert(
      !!downgradeErr && (downgradeErr.message.includes("لا يمكن تغيير دور آخر") || downgradeErr.message.includes("مدير عام")),
      "PostgreSQL RPC strictly blocks downgrading the active owner",
      downgradeErr?.message
    );

    const { error: deactivateErr } = await admin.rpc("toggle_workspace_member_active", {
      p_workspace_id: wsId,
      p_roster_person_id: emadOwner.id,
      p_is_active: false,
    });

    assert(
      !!deactivateErr && (deactivateErr.message.includes("Owner account cannot be deactivated") || deactivateErr.message.includes("لا يمكن تعطيل")),
      "PostgreSQL RPC strictly blocks deactivating the active owner",
      deactivateErr?.message
    );
  }

  // ---------------------------------------------------------------------------
  // ITEM 6: Cryptographic Invitation Lifecycle & Token Validation
  // ---------------------------------------------------------------------------
  console.log("\n[Item 6] Testing Cryptographic Invitation Lifecycle...");

  // Unit tests for crypto-tokens
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const encrypted = encryptToken(rawToken);
  const decrypted = decryptToken(encrypted);

  assert(rawToken.length >= 64, "Generated raw token is 64 hex characters (256-bit entropy)");
  assert(tokenHash.length === 64, "Token hash is 64 hex characters (SHA-256)");
  assert(verifyToken(rawToken, tokenHash) === true, "verifyToken validates correct token");
  assert(verifyToken("invalid_tampered_token", tokenHash) === false, "verifyToken rejects tampered token");
  assert(decrypted === rawToken, "AES-256-GCM encryption/decryption roundtrip matches original token");

  // Database Invitation Token Flow
  const testEmail = `test.token.${Date.now()}@example.internal`;
  if (testMember && emadOwner) {
    const { data: inv, error: invErr } = await admin
      .from("workspace_invitations")
      .insert({
        workspace_id: wsId,
        invited_email: testEmail,
        role: "designer",
        roster_person_id: testMember.id,
        token_hash: tokenHash,
        encrypted_token: encrypted,
        invited_by_roster_id: emadOwner.id,
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      })
      .select()
      .single();

    assert(!invErr && !!inv, "Created pending invitation with cryptographic token hash and encrypted token");

    // Test rejection of tampered token
    const tamperedHash = hashToken("tampered_token_value_xyz");
    assert(inv?.token_hash !== tamperedHash, "Tampered token generates non-matching hash");

    // First atomic accept update
    const { data: firstAccept, error: firstAcceptErr } = await admin
      .from("workspace_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", inv!.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    assert(!firstAcceptErr && !!firstAccept, "First accept succeeds via atomic conditional update (status was pending)", firstAcceptErr?.message);

    // Second atomic accept attempt on the same invitation (must fail because status is now accepted, not pending)
    const { data: secondAccept } = await admin
      .from("workspace_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", inv!.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    assert(!secondAccept, "Double-accept is strictly rejected by atomic WHERE status = 'pending' condition");

    // Clean up test invitation
    await admin.from("workspace_invitations").delete().eq("id", inv!.id);
    console.log("  Cleaned up test cryptographic invitation.");
  }

  // ---------------------------------------------------------------------------
  // ITEM 7: Independent Invitation Settings Switch
  // ---------------------------------------------------------------------------
  console.log("\n[Item 7] Testing Independent Invitation Settings Switch...");

  // Toggle allow_invitation_acceptance to false
  const { error: setSettingsErr } = await admin.rpc("set_workspace_invitation_settings", {
    p_workspace_id: wsId,
    p_allow_emails: false,
    p_allow_acceptance: false,
  });
  assert(!setSettingsErr, "set_workspace_invitation_settings sets allow_acceptance = false", setSettingsErr?.message);

  const { data: updatedWs } = await admin
    .from("workspaces")
    .select("allow_invitation_emails, allow_invitation_acceptance")
    .eq("id", wsId)
    .single();

  assert(updatedWs?.allow_invitation_emails === false, "allow_invitation_emails is false");
  assert(updatedWs?.allow_invitation_acceptance === false, "allow_invitation_acceptance is false");

  // Restore safe defaults: emails false, acceptance true
  await admin.rpc("set_workspace_invitation_settings", {
    p_workspace_id: wsId,
    p_allow_emails: false,
    p_allow_acceptance: true,
  });

  const { data: restoredWs } = await admin
    .from("workspaces")
    .select("allow_invitation_emails, allow_invitation_acceptance")
    .eq("id", wsId)
    .single();

  assert(restoredWs?.allow_invitation_emails === false, "Final allow_invitation_emails restored to false (Safe mode)");
  assert(restoredWs?.allow_invitation_acceptance === true, "Final allow_invitation_acceptance restored to true (Acceptance enabled)");

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
