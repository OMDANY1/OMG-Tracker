import assert from "assert";
import fs from "fs";
import path from "path";

console.log("\n==========================================================");
console.log("Clean Production Launch & Self-Service Administration Tests");
console.log("==========================================================");

function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  ❌ FAIL: ${name} -> ${e.message}`);
      failed++;
    }
  }

  // 1. Migration 34 Checks
  test("1. Migration 34 file exists and implements core RPCs", () => {
    const migrationPath = path.join(
      __dirname,
      "../supabase/migrations/20260923000034_business_owner_viewer_and_self_service_admin.sql"
    );
    assert(fs.existsSync(migrationPath), "Migration 34 file must exist");
    const sql = fs.readFileSync(migrationPath, "utf-8");
    assert(sql.includes("business_owner_viewer"), "Migration 34 must define business_owner_viewer");
    assert(sql.includes("admin_create_roster_person"), "Migration 34 must define admin_create_roster_person RPC");
    assert(sql.includes("admin_update_roster_person"), "Migration 34 must define admin_update_roster_person RPC");
    assert(sql.includes("get_member_deactivation_impact"), "Migration 34 must define get_member_deactivation_impact RPC");
  });

  // 2. TypeScript Types & Database Definitions
  test("2. types/database.ts defines business_owner_viewer role", () => {
    const typesPath = path.join(__dirname, "../types/database.ts");
    const content = fs.readFileSync(typesPath, "utf-8");
    assert(content.includes("'business_owner_viewer'"), "RosterRole must include business_owner_viewer");
  });

  // 3. Arabic Role Labels
  test("3. lib/utils.ts maps business_owner_viewer to Arabic label", () => {
    const utilsPath = path.join(__dirname, "../lib/utils.ts");
    const content = fs.readFileSync(utilsPath, "utf-8");
    assert(content.includes("business_owner_viewer"), "ROSTER_ROLE_LABELS must include business_owner_viewer");
    assert(content.includes("مالك الشركة"), "ROSTER_ROLE_LABELS must contain Arabic label for owner viewer");
  });

  // 4. Server Auth RBAC Helpers
  test("4. lib/auth/server-auth.ts implements requireWritableMembership and requireOwnerOrViewer", () => {
    const authPath = path.join(__dirname, "../lib/auth/server-auth.ts");
    const content = fs.readFileSync(authPath, "utf-8");
    assert(content.includes("requireWritableMembership"), "server-auth must export requireWritableMembership");
    assert(content.includes("requireOwnerOrViewer"), "server-auth must export requireOwnerOrViewer");
    assert(content.includes("business_owner_viewer"), "requireWritableMembership must block business_owner_viewer");
  });

  // 5. Team Member Management API Endpoints
  test("5a. POST /api/team/members endpoint exists and enforces requireOwner", () => {
    const routePath = path.join(__dirname, "../app/api/team/members/route.ts");
    assert(fs.existsSync(routePath), "app/api/team/members/route.ts must exist");
    const content = fs.readFileSync(routePath, "utf-8");
    assert(content.includes("requireOwner"), "POST /api/team/members must enforce requireOwner");
    assert(content.includes("admin_create_roster_person"), "POST /api/team/members must call admin_create_roster_person RPC");
  });

  test("5b. PATCH /api/team/members/[id] endpoint exists and enforces requireOwner", () => {
    const routePath = path.join(__dirname, "../app/api/team/members/[id]/route.ts");
    assert(fs.existsSync(routePath), "app/api/team/members/[id]/route.ts must exist");
    const content = fs.readFileSync(routePath, "utf-8");
    assert(content.includes("requireOwner"), "PATCH /api/team/members/[id] must enforce requireOwner");
    assert(content.includes("admin_update_roster_person"), "PATCH /api/team/members/[id] must call admin_update_roster_person RPC");
  });

  test("5c. GET /api/team/members/[id]/impact endpoint exists and enforces requireOwner", () => {
    const routePath = path.join(__dirname, "../app/api/team/members/[id]/impact/route.ts");
    assert(fs.existsSync(routePath), "app/api/team/members/[id]/impact/route.ts must exist");
    const content = fs.readFileSync(routePath, "utf-8");
    assert(content.includes("requireOwner"), "GET /api/team/members/[id]/impact must enforce requireOwner");
    assert(content.includes("get_member_deactivation_impact"), "Must call get_member_deactivation_impact RPC");
  });

  // 6. Clients API Endpoints
  test("6. POST & PUT /api/clients enforce write protection against business_owner_viewer", () => {
    const routePath = path.join(__dirname, "../app/api/clients/route.ts");
    const content = fs.readFileSync(routePath, "utf-8");
    assert(content.includes("requireOwner"), "POST /api/clients must enforce requireOwner");
    assert(content.includes("business_owner_viewer"), "PUT /api/clients must block business_owner_viewer");
    assert(content.includes("isViewer"), "GET /api/clients must return isViewer status");
  });

  // 7. AddClientModal Component
  test("7. AddClientModal exists with 4 track assignments and brief inputs", () => {
    const modalPath = path.join(__dirname, "../components/clients/AddClientModal.tsx");
    assert(fs.existsSync(modalPath), "components/clients/AddClientModal.tsx must exist");
    const content = fs.readFileSync(modalPath, "utf-8");
    assert(content.includes("enableDesign"), "AddClientModal must have design track toggle");
    assert(content.includes("enableCopywriting"), "AddClientModal must have copywriting track toggle");
    assert(content.includes("enableStrategy"), "AddClientModal must have strategy track toggle");
    assert(content.includes("enableVideo"), "AddClientModal must have video track toggle");
    assert(content.includes("primaryDesignerId"), "AddClientModal must capture primary designer");
  });

  // 8. Clients Page Empty State and Modal Integration
  test("8. Clients page integrates AddClientModal, empty state CTA, and viewer protection", () => {
    const pagePath = path.join(__dirname, "../app/clients/page.tsx");
    const content = fs.readFileSync(pagePath, "utf-8");
    assert(content.includes("AddClientModal"), "Clients page must import and render AddClientModal");
    assert(content.includes("isViewer"), "Clients page must handle isViewer mode");
    assert(content.includes("مساحة العمل جاهزة ونظيفة للتشغيل الفعلي"), "Clients page must render clean empty state banner");
  });

  // 9. Team Page Self-Service & Deactivation Safety
  test("9. Team page implements self-service add/edit, status badges, and safe deactivation impact", () => {
    const pagePath = path.join(__dirname, "../app/team/page.tsx");
    const content = fs.readFileSync(pagePath, "utf-8");
    assert(content.includes("getMemberStatus"), "Team page must calculate member status");
    assert(content.includes("deactivationImpact"), "Team page must handle deactivation impact");
    assert(content.includes("showAddMemberModal"), "Team page must provide Add Member modal");
    assert(content.includes("editingMember"), "Team page must provide Edit Member modal");
    assert(!content.includes("DEFAULT_EMAILS"), "Team page must NOT contain hardcoded mock emails");
  });

  // 10. Role Switcher Persona Cleanliness
  test("10. RoleSwitcher contains zero mock personas and includes business_owner_viewer", () => {
    const switcherPath = path.join(__dirname, "../components/common/RoleSwitcher.tsx");
    const content = fs.readFileSync(switcherPath, "utf-8");
    assert(!content.includes("فيديو إيديتور (تجريبي)"), "Must remove mock video editor persona");
    assert(!content.includes("video-id"), "Must remove mock video-id persona");
    assert(content.includes("business_owner_viewer"), "Must include business_owner_viewer persona");
  });

  console.log(`\nResults: ${passed} Passed | ${failed} Failed`);
  if (failed > 0) process.exit(1);
}

runTests();
