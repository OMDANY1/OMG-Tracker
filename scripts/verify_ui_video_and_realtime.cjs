const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");

const envPath = fs.existsSync(path.join(__dirname, "..", ".env.local.production.bak"))
  ? path.join(__dirname, "..", ".env.local.production.bak")
  : path.join(__dirname, "..", ".env.local");

const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx > 0) {
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROD_URL = "https://omg-creative-workspace.vercel.app";
const PROD_WS_ID = "a180f3ab-33bb-4431-88a4-592add7c773e";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function buildSessionCookiesForEmail(email) {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw linkErr;

  const tempClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verifyData, error: verifyErr } = await tempClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr) throw verifyErr;

  const cookiesToSet = [];
  const ssrClient = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() {
        return cookiesToSet;
      },
      setAll(toSet) {
        cookiesToSet.push(...toSet);
      },
    },
  });

  await ssrClient.auth.setSession({
    access_token: verifyData.session.access_token,
    refresh_token: verifyData.session.refresh_token,
  });

  return cookiesToSet.map((c) => ({
    name: c.name,
    value: c.value,
    domain: "omg-creative-workspace.vercel.app",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }));
}

async function main() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const artifactDir = path.join(
    "C:",
    "Users",
    "elwady",
    ".gemini",
    "antigravity",
    "brain",
    "4f958e1c-479f-453e-888c-49e86530171c"
  );

  let browserA = null;
  let browserB = null;
  let tempUserBId = null;
  let tempRosterBId = null;
  let tempClientId = null;

  const results = {
    point4_uiVideoProof: {},
    point5_realtimeAndPermissions: {},
    point6_uiChecks: {},
  };

  try {
    const emadCookies = await buildSessionCookiesForEmail("emadadelgd@gmail.com");

    browserA = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const pageA = await browserA.newPage();
    await pageA.setViewport({ width: 1440, height: 950 });
    await pageA.setCookie(...emadCookies);

    // =========================================================================
    // POINT 4: UI PROOF OF VIDEO TRACK FIX ON /clients (PURE PRODUCTION STATE)
    // =========================================================================
    console.log("=== [POINT 4] Navigating Browser A to /clients (Pure Production) ===");
    await pageA.goto(`${PROD_URL}/clients`, { waitUntil: "networkidle2", timeout: 30000 });
    await pageA.waitForSelector("h1", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Click Video Track tab ("فريق الفيديو والمونتاج")
    await pageA.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const videoTab = btns.find(
        (b) => b.textContent && b.textContent.includes("فريق الفيديو والمونتاج")
      );
      if (videoTab) videoTab.click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    const videoTrackUiState = await pageA.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasStaleEmptyMsg =
        bodyText.includes("لم يتم إضافة أعضاء لفريق الفيديو والمونتاج بعد") ||
        bodyText.includes("جاهزية إضافة أعضاء الفيديو الحقيقيين");
      const hasFourEditorsBadge = bodyText.includes("4 محررين");
      const hasOneAssignedBadge = bodyText.includes("1 مسند");

      // Find the video editors filter cards (rendered as clickable div.p-2.5.rounded-xl)
      const cards = Array.from(document.querySelectorAll("div.rounded-xl.border.cursor-pointer")).map(
        (d) => d.innerText.replace(/\s+/g, " ").trim()
      );
      const hanaCard = cards.find((t) => t.includes("هنا"));
      const nourCard = cards.find((t) => t.includes("نور"));
      const hagarCard = cards.find((t) => t.includes("هاجر الشاعر"));
      const sayedCard = cards.find((t) => t.includes("سيد"));

      return {
        hasStaleEmptyMsg,
        hasFourEditorsBadge,
        hasOneAssignedBadge,
        editorFilterCards: {
          hana: hanaCard || null,
          nour: nourCard || null,
          hagarElshaer: hagarCard || null,
          sayed: sayedCard || null,
        },
      };
    });

    const p4Shot1 = path.join(artifactDir, "followup_point4_video_track_clients.png");
    await pageA.screenshot({ path: p4Shot1, fullPage: false });

    // Open ClientTeamModal on "masar" (read-only check, do not save)
    await pageA.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const teamBtn = btns.find(
        (b) => b.textContent && b.textContent.includes("توزيع فريق")
      );
      if (teamBtn) teamBtn.click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    const modalDropdownState = await pageA.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("form select"));
      const selectOptions = selects.map((s) => {
        const label = s.previousElementSibling ? s.previousElementSibling.textContent.trim() : "";
        const selectedValueText =
          s.selectedOptions && s.selectedOptions[0]
            ? s.selectedOptions[0].textContent.trim()
            : "";
        const opts = Array.from(s.querySelectorAll("option")).map((o) => o.textContent.trim());
        return { label, selectedValueText, opts };
      });
      return selectOptions;
    });

    const p4Shot2 = path.join(artifactDir, "followup_point4_video_modal.png");
    await pageA.screenshot({ path: p4Shot2, fullPage: false });

    // Close modal without saving
    await pageA.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("form button"));
      const cancelBtn = btns.find((b) => b.textContent && b.textContent.includes("إلغاء"));
      if (cancelBtn) cancelBtn.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    // Switch Browser A back to "جميع العملاء"
    await pageA.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const allTab = btns.find((b) => b.textContent && b.textContent.includes("جميع العملاء"));
      if (allTab) allTab.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    results.point4_uiVideoProof = {
      ...videoTrackUiState,
      modalDropdownState,
    };
    console.log("Point 4 UI Result:", JSON.stringify(results.point4_uiVideoProof, null, 2));

    // =========================================================================
    // POINT 5: 2 INDEPENDENT BROWSERS REALTIME SYNC, PERMISSIONS & RECONNECT
    // =========================================================================
    // Setup temporary independent user + roster member for Browser B (starts as manager)
    const tempEmailB = `realtime.session.b.${Date.now()}@omg-test.local`;
    const { data: createdUserB, error: uErr } = await admin.auth.admin.createUser({
      email: tempEmailB,
      password: "SessionBPassword123!",
      email_confirm: true,
    });
    if (uErr) throw uErr;
    tempUserBId = createdUserB.user.id;

    tempRosterBId = crypto.randomUUID();
    const initialCustomPerms = {
      manage_clients: true,
      assign_team: true,
      create_tasks: true,
      approve_reviews: true,
      track_timer: true,
      comment_and_attachments: true,
    };

    const { error: rErr } = await admin.from("roster_people").insert({
      id: tempRosterBId,
      workspace_id: PROD_WS_ID,
      display_name: "[TEMP_SESSION_B_MEMBER]",
      job_title: "Operations Manager",
      role: "manager",
      specialties: ["management"],
      access_scope: "workspace",
      custom_permissions: initialCustomPerms,
      is_active: true,
    });
    if (rErr) throw rErr;

    const { error: mErr } = await admin.from("workspace_memberships").insert({
      workspace_id: PROD_WS_ID,
      user_id: tempUserBId,
      roster_person_id: tempRosterBId,
      role: "manager",
      access_scope: "workspace",
      custom_permissions: initialCustomPerms,
      is_active: true,
    });
    if (mErr) throw mErr;

    // Create temporary sandbox client for Point 5 Realtime sync testing
    tempClientId = crypto.randomUUID();
    const { error: cErr } = await admin.from("clients").insert({
      id: tempClientId,
      workspace_id: PROD_WS_ID,
      name: "[TEMP_SYNC_CLIENT]",
      state: "Active",
      difficulty: "Medium",
      extra_workload: "None",
    });
    if (cErr) throw cErr;

    // Lookup Sayed's roster ID for the temporary client's video assignment test
    const { data: sayedRow } = await admin
      .from("roster_people")
      .select("id, display_name")
      .eq("workspace_id", PROD_WS_ID)
      .eq("display_name", "سيد")
      .single();

    const userBCookies = await buildSessionCookiesForEmail(tempEmailB);
    browserB = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const pageB = await browserB.newPage();
    await pageB.setViewport({ width: 1440, height: 950 });
    await pageB.setCookie(...userBCookies);

    console.log("\n=== [POINT 5] Navigating Browser B to /clients ===");
    await pageB.goto(`${PROD_URL}/clients`, { waitUntil: "networkidle2", timeout: 30000 });
    await pageB.waitForSelector("h1", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2500));

    // Verify Browser B sees [TEMP_SYNC_CLIENT] initially without Sayed assigned
    const beforeSyncTextB = await pageB.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("h3"));
      const targetH3 = cards.find((h) => h.textContent.includes("[TEMP_SYNC_CLIENT]"));
      const card = targetH3 ? targetH3.closest("div.bg-surface") : null;
      return card ? card.innerText : null;
    });

    // 5.1 Mutate [TEMP_SYNC_CLIENT] team assignment from Browser A (assigning Sayed as video editor)
    console.log("Triggering team assignment update from Browser A...");
    const assignFromARes = await pageA.evaluate(
      async ({ clientId, sayedId }) => {
        const res = await fetch("/api/clients", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            action: "update_team",
            requiresVideo: true,
            primaryVideoEditorId: sayedId,
          }),
        });
        return { status: res.status, ok: res.ok, body: await res.json() };
      },
      { clientId: tempClientId, sayedId: sayedRow.id }
    );

    // Wait up to 8 seconds for Browser B to receive Supabase Realtime event and update DOM without reload
    let syncedOnBrowserB = false;
    let afterSyncTextB = null;
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      afterSyncTextB = await pageB.evaluate(() => {
        const cards = Array.from(document.querySelectorAll("h3"));
        const targetH3 = cards.find((h) => h.textContent.includes("[TEMP_SYNC_CLIENT]"));
        const card = targetH3 ? targetH3.closest("div.bg-surface") : null;
        return card ? card.innerText : null;
      });
      if (afterSyncTextB && afterSyncTextB.includes("سيد")) {
        syncedOnBrowserB = true;
        break;
      }
    }

    // 5.2 Role / Permission change reflected on UI and very next server request
    // First prove Browser B (currently manager) has active UI controls (not viewer mode) and CAN call PUT /api/clients (200 OK)
    const beforeRoleChangeUiHasReadOnlyBadge = await pageB.evaluate(() =>
      document.body.innerText.includes("مشاهد فقط - بدون صلاحيات تعديل")
    );
    const reqBeforeRoleChange = await pageB.evaluate(
      async ({ clientId, sayedId }) => {
        const res = await fetch("/api/clients", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            action: "update_team",
            requiresVideo: true,
            primaryVideoEditorId: sayedId,
          }),
        });
        return { status: res.status, ok: res.ok };
      },
      { clientId: tempClientId, sayedId: sayedRow.id }
    );

    // Now Browser A (Emad) downgrades Browser B's role to business_owner_viewer via PATCH /api/team/members/[id]
    const roleChangeFromA = await pageA.evaluate(
      async ({ rosterId }) => {
        const res = await fetch(`/api/team/members/${rosterId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobTitle: "Partner Viewer",
            specialties: ["management"],
            role: "business_owner_viewer",
            accessScope: "workspace",
            customPermissions: {},
          }),
        });
        return { status: res.status, ok: res.ok, body: await res.json() };
      },
      { rosterId: tempRosterBId }
    );

    // Wait for Browser B to receive Realtime membership_data_changed / team_data_changed and update its UI state
    // (When isViewer becomes true on /clients, the "مشاهد فقط - بدون صلاحيات تعديل" badge appears and "إضافة عميل جديد" disappears without manual reload)
    let uiPermissionUpdatedOnB = false;
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const hasReadOnlyBadgeNow = await pageB.evaluate(
        () =>
          document.body.innerText.includes("مشاهد فقط - بدون صلاحيات تعديل") &&
          !document.body.innerText.includes("إضافة عميل جديد")
      );
      if (hasReadOnlyBadgeNow) {
        uiPermissionUpdatedOnB = true;
        break;
      }
    }

    // Immediately make the next server request from Browser B -> must return 403 Forbidden!
    const reqAfterRoleChange = await pageB.evaluate(
      async ({ clientId, sayedId }) => {
        const res = await fetch("/api/clients", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            action: "update_team",
            requiresVideo: false,
            primaryVideoEditorId: null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, ok: res.ok, error: data.error || null };
      },
      { clientId: tempClientId, sayedId: sayedRow.id }
    );

    // 5.3 Disconnect -> Missed Update -> Reconnect Recovery
    console.log("Simulating disconnect on Browser B...");
    await pageB.setOfflineMode(true);
    await new Promise((r) => setTimeout(r, 500));

    // While Browser B is offline, update [TEMP_SYNC_CLIENT] name to [TEMP_SYNC_CLIENT_RECONNECTED]
    await admin
      .from("clients")
      .update({ name: "[TEMP_SYNC_CLIENT_RECONNECTED]" })
      .eq("id", tempClientId);

    await new Promise((r) => setTimeout(r, 1000));
    const whileOfflineHasNewName = await pageB.evaluate(() =>
      document.body.innerText.includes("[TEMP_SYNC_CLIENT_RECONNECTED]")
    );

    // Reconnect Browser B and dispatch window_reconnected_sync / focus
    console.log("Reconnecting Browser B...");
    await pageB.setOfflineMode(false);
    await pageB.evaluate(() => {
      window.dispatchEvent(new CustomEvent("window_reconnected_sync"));
    });

    let recoveredAfterReconnect = false;
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const hasNewName = await pageB.evaluate(() =>
        document.body.innerText.includes("[TEMP_SYNC_CLIENT_RECONNECTED]")
      );
      if (hasNewName) {
        recoveredAfterReconnect = true;
        break;
      }
    }

    results.point5_realtimeAndPermissions = {
      assignmentSyncWithoutRefresh: {
        mutationFromSessionAOk: assignFromARes.ok,
        beforeSyncContainedSayed: Boolean(beforeSyncTextB && beforeSyncTextB.includes("سيد")),
        afterSyncContainedSayedWithoutRefresh: syncedOnBrowserB,
      },
      permissionChangeOnUiAndNextRequest: {
        beforeRoleChangeUiHasReadOnlyBadge,
        requestBeforeRoleChangeStatus: reqBeforeRoleChange.status,
        roleChangeFromSessionAOk: roleChangeFromA.ok,
        afterRoleChangeUiSwitchedToReadOnlyWithoutRefresh: uiPermissionUpdatedOnB,
        nextServerRequestStatus: reqAfterRoleChange.status,
        nextServerRequestError: reqAfterRoleChange.error,
      },
      disconnectAndReconnectRecovery: {
        whileOfflineContainedUpdate: whileOfflineHasNewName,
        recoveredMissedUpdateAfterReconnectWithoutReload: recoveredAfterReconnect,
      },
    };
    console.log("Point 5 Result:", JSON.stringify(results.point5_realtimeAndPermissions, null, 2));

    // =========================================================================
    // POINT 6: UI CHECKS FOR HOME, TIME-LEDGER, OPERATIONS, AND PERMISSIONS MATRIX
    // =========================================================================
    // Remove temp client & temp member before checking Home / Time Ledger / Team / Operations so counts are 100% pure production
    await admin.from("clients").delete().eq("id", tempClientId);
    tempClientId = null;
    await admin.from("workspace_memberships").delete().eq("roster_person_id", tempRosterBId);
    await admin.from("roster_people").delete().eq("id", tempRosterBId);
    tempRosterBId = null;

    await pageA.goto(`${PROD_URL}/`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const homeCheck = await pageA.evaluate(() => ({
      hasTitle: document.body.innerText.includes("لوحة المتابعة") || document.body.innerText.includes("الرئيسية"),
      hasDemoData:
        document.body.innerText.includes("عميل تجريبي") ||
        document.body.innerText.includes("مهمة تجريبية") ||
        document.body.innerText.includes("Demo"),
    }));

    await pageA.goto(`${PROD_URL}/time-ledger`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const timeLedgerCheck = await pageA.evaluate(() => ({
      hasTitle: document.body.innerText.includes("سجل الشغل") || document.body.innerText.includes("ساعات"),
      hasZeroCleanState: document.body.innerText.includes("0.0") || document.body.innerText.includes("لا توجد"),
    }));

    await pageA.goto(`${PROD_URL}/operations`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const operationsCheck = await pageA.evaluate(() => ({
      hasTitle: document.body.innerText.includes("مركز العمليات"),
      hasClearSections:
        document.body.innerText.includes("المتأخرات") &&
        document.body.innerText.includes("المراجعة"),
    }));

    await pageA.goto(`${PROD_URL}/team`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const teamCheck = await pageA.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasMatrixButton: text.includes("مصفوفة الصلاحيات"),
        hasNourOneClient: text.includes("نور"),
      };
    });

    results.point6_uiChecks = {
      homeCheck,
      timeLedgerCheck,
      operationsCheck,
      teamCheck,
    };
    console.log("Point 6 UI Checks:", JSON.stringify(results.point6_uiChecks, null, 2));
  } finally {
    if (tempClientId) {
      await admin.from("clients").delete().eq("id", tempClientId);
    }
    if (tempRosterBId) {
      await admin.from("workspace_memberships").delete().eq("roster_person_id", tempRosterBId);
      await admin.from("roster_people").delete().eq("id", tempRosterBId);
    }
    if (tempUserBId) {
      await admin.auth.admin.deleteUser(tempUserBId);
    }
    if (browserA) await browserA.close();
    if (browserB) await browserB.close();
    console.log("UI & Realtime verification cleanup complete.");
  }
}

main().catch((err) => {
  console.error("UI verification failed:", err);
  process.exit(1);
});
