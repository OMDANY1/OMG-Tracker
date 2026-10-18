const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
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
const BASE_URL = process.env.TEST_BASE_URL || "https://omg-creative-workspace.vercel.app";
const PROD_WS_ID = "a180f3ab-33bb-4431-88a4-592add7c773e";
const ARTIFACT_DIR = "C:/Users/elwady/.gemini/antigravity/brain/4f958e1c-479f-453e-888c-49e86530171c";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

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

async function cleanupLeftoverTestWorkspaces() {
  const { data: wsList } = await admin
    .from("workspaces")
    .select("id, name")
    .neq("id", PROD_WS_ID);

  for (const ws of wsList || []) {
    if (
      ws.name.includes("ISOLATED_TEST") ||
      ws.name.includes("ISOLATED_CLIENT") ||
      ws.name.includes("TEST_WS")
    ) {
      console.log(`Cleaning up leftover test workspace: ${ws.id} (${ws.name})`);
      await admin.from("rpc_idempotency_records").delete().eq("workspace_id", ws.id);
      await admin.from("audit_events").delete().eq("workspace_id", ws.id);
      await admin.from("client_briefs").delete().eq("workspace_id", ws.id);
      await admin.from("client_team_assignments").delete().eq("workspace_id", ws.id);
      await admin.from("clients").delete().eq("workspace_id", ws.id);
      await admin.from("workspace_memberships").delete().eq("workspace_id", ws.id);
      await admin.from("roster_people").delete().eq("workspace_id", ws.id);
      await admin.from("workspaces").delete().eq("id", ws.id);
    }
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log(`Running end-to-end client creation verification against: ${BASE_URL}`);

  await cleanupLeftoverTestWorkspaces();

  const { data: prodClientsBefore } = await admin
    .from("clients")
    .select("id, name, state")
    .eq("workspace_id", PROD_WS_ID);
  console.log("Production clients before test:", prodClientsBefore);

  const ts = Date.now();
  const ownerEmail = `iso.owner.${ts}@example.com`;
  const password = `IsoTestPass!${ts}`;

  let ownerUserId = null;
  let testWsId = null;
  let browser = null;

  const report = {
    baseUrl: BASE_URL,
    timestamp: new Date().toISOString(),
    rahmanGroupPreviouslyCreated: false,
    productionBaselineBefore: prodClientsBefore,
    scenarios: {},
    productionBaselineAfter: null,
  };

  try {
    // Check if RAHMAN GROUP exists in production
    const { data: rahmanCheck } = await admin
      .from("clients")
      .select("id, name, workspace_id")
      .ilike("name", "%RAHMAN%");
    report.rahmanGroupPreviouslyCreated = (rahmanCheck && rahmanCheck.length > 0) || false;

    // 1. Create isolated test user + isolated workspace
    const { data: u1, error: u1Err } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: "عماد (بيئة فحص معزولة)" },
    });
    if (u1Err) throw u1Err;
    ownerUserId = u1.user.id;

    const { data: ws, error: wsErr } = await admin
      .from("workspaces")
      .insert({
        name: `[ISOLATED_CLIENT_CREATION_TEST_WS_${ts}]`,
        allow_invitation_acceptance: true,
        invitations_paused: false,
      })
      .select("id")
      .single();
    if (wsErr) throw wsErr;
    testWsId = ws.id;

    const { data: ownerRoster, error: rOwnerErr } = await admin
      .from("roster_people")
      .insert({
        workspace_id: testWsId,
        display_name: "عماد",
        role: "owner",
        specialties: ["strategy", "design", "content_writing", "video_editing"],
        job_title: "Creative Director",
        is_active: true,
      })
      .select("id")
      .single();
    if (rOwnerErr) throw rOwnerErr;

    const { error: memErr } = await admin.from("workspace_memberships").insert({
      workspace_id: testWsId,
      user_id: ownerUserId,
      roster_person_id: ownerRoster.id,
      role: "owner",
      is_active: true,
    });
    if (memErr) throw memErr;

    const { data: designerRoster, error: rDesErr } = await admin
      .from("roster_people")
      .insert({
        workspace_id: testWsId,
        display_name: "سارة (مصممة)",
        role: "designer",
        specialties: ["design"],
        job_title: "Senior Graphic Designer",
        is_active: true,
      })
      .select("id")
      .single();
    if (rDesErr) throw rDesErr;

    const { data: copyRoster, error: rCopErr } = await admin
      .from("roster_people")
      .insert({
        workspace_id: testWsId,
        display_name: "آية (كاتبة محتوى)",
        role: "content_writer",
        specialties: ["content_writing"],
        job_title: "Content Writer",
        is_active: true,
      })
      .select("id")
      .single();
    if (rCopErr) throw rCopErr;

    const { data: strategyRoster, error: rStrErr } = await admin
      .from("roster_people")
      .insert({
        workspace_id: testWsId,
        display_name: "أروى (استراتيجية)",
        role: "strategy_lead",
        specialties: ["strategy"],
        job_title: "Strategy Lead",
        is_active: true,
      })
      .select("id")
      .single();
    if (rStrErr) throw rStrErr;

    const { data: videoRoster, error: rVidErr } = await admin
      .from("roster_people")
      .insert({
        workspace_id: testWsId,
        display_name: "نور (مونتير)",
        role: "video_editor",
        specialties: ["video_editing"],
        job_title: "Video Editor",
        is_active: true,
      })
      .select("id")
      .single();
    if (rVidErr) throw rVidErr;

    // Launch browser and set session cookies
    const sessionCookies = await buildSessionCookiesForEmail(ownerEmail);
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 980 });
    await page.setCookie(...sessionCookies);

    await page.goto(`${BASE_URL}/clients`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("h1", { timeout: 20000 });
    await delay(1500);

    // Helper to click a button by text
    async function clickButtonByText(textSubstring) {
      await page.evaluate((sub) => {
        const btns = Array.from(document.querySelectorAll("button"));
        const target = btns.find((b) => (b.innerText || "").includes(sub) && !b.disabled);
        if (!target) throw new Error(`Button containing "${sub}" not found`);
        target.click();
      }, textSubstring);
    }

    // Helper to set input value in React 18 reliably
    async function setReactInputValue(selector, index, value) {
      await page.evaluate(
        ({ sel, idx, val }) => {
          const els = document.querySelectorAll(sel);
          const el = els[idx];
          if (!el) throw new Error(`Element ${sel}[${idx}] not found`);
          const lastValue = el.value;
          const proto =
            el.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : el.tagName === "SELECT"
              ? window.HTMLSelectElement.prototype
              : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          nativeSetter.call(el, val);
          if (el._valueTracker) {
            el._valueTracker.setValue(lastValue);
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        },
        { sel: selector, idx: index, val: value }
      );
    }

    async function openModalAndFillBase(clientName, enableVideoTrack = false) {
      await clickButtonByText("إضافة عميل جديد");
      await delay(600);

      // Fill client name
      await setReactInputValue('div.fixed input[placeholder*="Zen Coffee"]', 0, clientName);

      // Default enabled track is Design:
      // Select 0: difficulty
      // Select 1: extraWorkload
      // Select 2: primaryDesignerId
      // Select 3: designReviewerId
      await setReactInputValue("div.fixed select", 2, designerRoster.id);

      // Ensure video checkbox matches enableVideoTrack
      await page.evaluate((shouldEnableVideo) => {
        const labels = Array.from(document.querySelectorAll("div.fixed label"));
        const vLabel = labels.find((l) => (l.innerText || "").includes("مسار إنتاج ومونتاج الفيديو"));
        const cb = vLabel?.querySelector('input[type="checkbox"]');
        if (cb && cb.checked !== shouldEnableVideo) cb.click();
      }, enableVideoTrack);
      await delay(250);

      if (enableVideoTrack) {
        await setReactInputValue("div.fixed select", 4, videoRoster.id);
      }

      // Reset the 3 optional URL fields to empty by default
      await setReactInputValue('div.fixed input[inputmode="url"]', 0, "");
      await setReactInputValue('div.fixed input[inputmode="url"]', 1, "");
      await setReactInputValue('div.fixed input[inputmode="url"]', 2, "");
      await delay(200);
    }

    // =========================================================================
    // SCENARIO 1: Create client WITHOUT any optional URLs (RAHMAN GROUP simulation)
    // =========================================================================
    console.log("Running Scenario 1: Create client without any optional URLs...");
    await openModalAndFillBase("RAHMAN GROUP - بدون روابط");

    // Check optional label count in modal
    const optionalBadgeCount = await page.evaluate(() => {
      return (document.body.innerText || "").split("اختياري — يمكن إضافته لاحقاً").length - 1;
    });

    const shot1Path = path.join(ARTIFACT_DIR, "verify_client_01_modal_optional_labels.png");
    await page.screenshot({ path: shot1Path, fullPage: false });

    const [res1] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/clients") && r.request().method() === "POST", { timeout: 25000 }),
      clickButtonByText("إنشاء وتفعيل العميل"),
    ]);
    const res1Status = res1.status();
    const res1Json = await res1.json();
    await delay(1100);

    const { data: dbClient1 } = await admin
      .from("clients")
      .select("id, name, state, brand_guide_url, brief_url")
      .eq("id", res1Json.client?.id)
      .single();
    const { data: dbBrief1 } = await admin
      .from("client_briefs")
      .select("brand_guidelines_url, assets_drive_url, status")
      .eq("client_id", res1Json.client?.id)
      .single();

    report.scenarios.scenario1_no_links = {
      passed:
        (res1Status === 200 || res1Status === 201) &&
        dbClient1?.state === "Active" &&
        dbClient1?.brand_guide_url === null &&
        dbClient1?.brief_url === null &&
        dbBrief1?.brand_guidelines_url === null &&
        dbBrief1?.assets_drive_url === null &&
        optionalBadgeCount >= 3,
      httpStatus: res1Status,
      optionalBadgeCount,
      dbClient: dbClient1,
      dbBrief: dbBrief1,
    };
    console.log("Scenario 1 Passed:", report.scenarios.scenario1_no_links.passed);

    // =========================================================================
    // SCENARIO 2: Create client with Brand Guide URL ONLY
    // =========================================================================
    console.log("Running Scenario 2: Create client with Brand Guide URL only...");
    await openModalAndFillBase("عميل بهوية فقط");
    await setReactInputValue('div.fixed input[inputmode="url"]', 0, "https://drive.google.com/drive/folders/brand-only-123");
    await setReactInputValue('div.fixed input[inputmode="url"]', 1, "");
    await setReactInputValue('div.fixed input[inputmode="url"]', 2, "");

    const [res2] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/clients") && r.request().method() === "POST", { timeout: 25000 }),
      clickButtonByText("إنشاء وتفعيل العميل"),
    ]);
    const res2Json = await res2.json();
    await delay(1100);

    const { data: dbClient2 } = await admin
      .from("clients")
      .select("id, name, state, brand_guide_url, brief_url")
      .eq("id", res2Json.client?.id)
      .single();
    const { data: dbBrief2 } = await admin
      .from("client_briefs")
      .select("brand_guidelines_url, assets_drive_url")
      .eq("client_id", res2Json.client?.id)
      .single();

    report.scenarios.scenario2_brand_guide_only = {
      passed:
        (res2.status() === 200 || res2.status() === 201) &&
        dbClient2?.brand_guide_url === "https://drive.google.com/drive/folders/brand-only-123" &&
        dbBrief2?.brand_guidelines_url === "https://drive.google.com/drive/folders/brand-only-123" &&
        dbBrief2?.assets_drive_url === null &&
        dbClient2?.brief_url === null,
      httpStatus: res2.status(),
      dbClient: dbClient2,
      dbBrief: dbBrief2,
    };
    console.log("Scenario 2 Passed:", report.scenarios.scenario2_brand_guide_only.passed);

    // =========================================================================
    // SCENARIO 3: Create client with Assets Drive URL ONLY
    // =========================================================================
    console.log("Running Scenario 3: Create client with Assets Drive URL only...");
    await openModalAndFillBase("عميل بأصول فقط");
    await setReactInputValue('div.fixed input[inputmode="url"]', 0, "");
    await setReactInputValue('div.fixed input[inputmode="url"]', 1, "https://drive.google.com/drive/folders/assets-only-456");
    await setReactInputValue('div.fixed input[inputmode="url"]', 2, "");

    const [res3] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/clients") && r.request().method() === "POST", { timeout: 25000 }),
      clickButtonByText("إنشاء وتفعيل العميل"),
    ]);
    const res3Json = await res3.json();
    await delay(1100);

    const { data: dbClient3 } = await admin
      .from("clients")
      .select("id, name, state, brand_guide_url, brief_url")
      .eq("id", res3Json.client?.id)
      .single();
    const { data: dbBrief3 } = await admin
      .from("client_briefs")
      .select("brand_guidelines_url, assets_drive_url")
      .eq("client_id", res3Json.client?.id)
      .single();

    report.scenarios.scenario3_assets_only = {
      passed:
        (res3.status() === 200 || res3.status() === 201) &&
        dbClient3?.brand_guide_url === null &&
        dbBrief3?.brand_guidelines_url === null &&
        dbBrief3?.assets_drive_url === "https://drive.google.com/drive/folders/assets-only-456" &&
        dbClient3?.brief_url === null,
      httpStatus: res3.status(),
      dbClient: dbClient3,
      dbBrief: dbBrief3,
    };
    console.log("Scenario 3 Passed:", report.scenarios.scenario3_assets_only.passed);

    // =========================================================================
    // SCENARIO 4: Create client with ALL 3 URLs
    // =========================================================================
    console.log("Running Scenario 4: Create client with all 3 URLs...");
    await openModalAndFillBase("عميل بكافة الروابط", true);
    await setReactInputValue('div.fixed input[inputmode="url"]', 0, "https://drive.google.com/drive/folders/full-brand-789");
    await setReactInputValue('div.fixed input[inputmode="url"]', 1, "https://drive.google.com/drive/folders/full-assets-789");
    await setReactInputValue('div.fixed input[inputmode="url"]', 2, "https://docs.google.com/document/d/full-brief-789");

    const [res4] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/clients") && r.request().method() === "POST", { timeout: 25000 }),
      clickButtonByText("إنشاء وتفعيل العميل"),
    ]);
    const res4Json = await res4.json();
    await delay(1100);

    const { data: dbClient4 } = await admin
      .from("clients")
      .select("id, name, state, brand_guide_url, brief_url")
      .eq("id", res4Json.client?.id)
      .single();
    const { data: dbTeam4 } = await admin
      .from("client_team_assignments")
      .select("requires_video, primary_video_editor_id")
      .eq("client_id", res4Json.client?.id)
      .single();
    const { data: dbBrief4 } = await admin
      .from("client_briefs")
      .select("brand_guidelines_url, assets_drive_url")
      .eq("client_id", res4Json.client?.id)
      .single();

    report.scenarios.scenario4_all_links = {
      passed:
        (res4.status() === 200 || res4.status() === 201) &&
        dbClient4?.brand_guide_url === "https://drive.google.com/drive/folders/full-brand-789" &&
        dbBrief4?.brand_guidelines_url === "https://drive.google.com/drive/folders/full-brand-789" &&
        dbBrief4?.assets_drive_url === "https://drive.google.com/drive/folders/full-assets-789" &&
        dbClient4?.brief_url === "https://docs.google.com/document/d/full-brief-789" &&
        dbTeam4?.requires_video === true,
      httpStatus: res4.status(),
      dbClient: dbClient4,
      dbTeam: dbTeam4,
      dbBrief: dbBrief4,
    };
    console.log("Scenario 4 Passed:", report.scenarios.scenario4_all_links.passed);

    // =========================================================================
    // SCENARIO 5: Reject invalid URL with clear Arabic error & preserve form data
    // =========================================================================
    console.log("Running Scenario 5: Reject invalid URL & preserve form fields...");
    await openModalAndFillBase("عميل اختبار رابط خاطئ");
    await setReactInputValue('div.fixed input[placeholder*="أي تعليمات"]', 0, "ملاحظات تشغيلية محفوظة لا تضيع عند الخطأ");
    await setReactInputValue('div.fixed input[inputmode="url"]', 0, "invalid-url-without-protocol");

    await clickButtonByText("إنشاء وتفعيل العميل");
    await delay(500);

    const uiValidationState = await page.evaluate(() => {
      const errBanner = document.querySelector("div.fixed .bg-rose-50");
      const nameInput = document.querySelector('div.fixed input[placeholder*="Zen Coffee"]');
      const notesInput = document.querySelector('div.fixed input[placeholder*="أي تعليمات"]');
      return {
        errorBannerText: errBanner ? errBanner.innerText : "",
        preservedName: nameInput ? nameInput.value : "",
        preservedNotes: notesInput ? notesInput.value : "",
      };
    });

    // Also test API-level invalid URL rejection
    const apiInvalidRes = await page.evaluate(async () => {
      const r = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "عميل رابط غير صالح عبر API",
          brandGuideUrl: "ftp://bad-scheme",
        }),
      });
      return { status: r.status, body: await r.json() };
    });

    const shot5Path = path.join(ARTIFACT_DIR, "verify_client_02_invalid_url_preserved_form.png");
    await page.screenshot({ path: shot5Path, fullPage: false });

    await clickButtonByText("إلغاء");
    await delay(500);

    const leaksTechnicalDetails =
      /create_client_atomic|schema cache|PGRST|p_brand_guide/i.test(uiValidationState.errorBannerText) ||
      /create_client_atomic|schema cache|PGRST|p_brand_guide/i.test(apiInvalidRes.body?.error || "");

    report.scenarios.scenario5_invalid_url_rejected = {
      passed:
        uiValidationState.errorBannerText.includes("رابط دليل الهوية غير صالح") &&
        uiValidationState.preservedName === "عميل اختبار رابط خاطئ" &&
        uiValidationState.preservedNotes === "ملاحظات تشغيلية محفوظة لا تضيع عند الخطأ" &&
        apiInvalidRes.status === 400 &&
        !leaksTechnicalDetails,
      uiErrorText: uiValidationState.errorBannerText,
      preservedName: uiValidationState.preservedName,
      preservedNotes: uiValidationState.preservedNotes,
      apiInvalidResponse: apiInvalidRes,
      leaksTechnicalDetails,
    };
    console.log("Scenario 5 Passed:", report.scenarios.scenario5_invalid_url_rejected.passed);

    // =========================================================================
    // SCENARIO 6: Add links later to an existing client (from Scenario 1) via ClientBriefModal
    // =========================================================================
    console.log("Running Scenario 6: Add links later to existing client via ClientBriefModal...");
    // Wait for any background refresh from previous scenarios to settle
    await delay(1200);

    // Open ClientBriefModal for "RAHMAN GROUP - بدون روابط"
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("div.bg-surface"));
      const targetCard = cards.find((c) => (c.innerText || "").includes("RAHMAN GROUP - بدون روابط"));
      const btns = Array.from((targetCard || document).querySelectorAll("button"));
      const briefBtn = btns.find((b) => (b.innerText || "").includes("الـ Brief"));
      if (!briefBtn) throw new Error("Brief button not found");
      briefBtn.click();
    });
    await page.waitForSelector('form input[inputmode="url"]', { timeout: 10000 });
    await delay(500);

    await setReactInputValue('form input[inputmode="url"]', 0, "https://drive.google.com/drive/folders/added-later-brand");
    await delay(100);
    await setReactInputValue('form input[inputmode="url"]', 1, "https://drive.google.com/drive/folders/added-later-assets");
    await delay(100);
    await setReactInputValue('form input[inputmode="url"]', 2, "https://docs.google.com/document/d/added-later-brief");
    await delay(300);

    const [res6] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/clients") && r.request().method() === "PUT", { timeout: 25000 }),
      clickButtonByText("حفظ مسودة الـBrief"),
    ]);
    const res6Status = res6.status();
    const res6Json = await res6.json();
    await delay(600);

    const shot6Path = path.join(ARTIFACT_DIR, "verify_client_03_brief_modal_links_added_later.png");
    await page.screenshot({ path: shot6Path, fullPage: false });

    await clickButtonByText("إغلاق");
    await delay(800);

    const { data: dbClient1After } = await admin
      .from("clients")
      .select("id, brand_guide_url, brief_url")
      .eq("id", dbClient1.id)
      .single();
    const { data: dbBrief1After } = await admin
      .from("client_briefs")
      .select("brand_guidelines_url, assets_drive_url")
      .eq("client_id", dbClient1.id)
      .single();

    report.scenarios.scenario6_add_links_later = {
      passed:
        res6Status === 200 &&
        dbClient1After?.brand_guide_url === "https://drive.google.com/drive/folders/added-later-brand" &&
        dbBrief1After?.brand_guidelines_url === "https://drive.google.com/drive/folders/added-later-brand" &&
        dbBrief1After?.assets_drive_url === "https://drive.google.com/drive/folders/added-later-assets" &&
        dbClient1After?.brief_url === "https://docs.google.com/document/d/added-later-brief",
      httpStatus: res6Status,
      res6Json,
      dbClientAfter: dbClient1After,
      dbBriefAfter: dbBrief1After,
    };
    console.log("Scenario 6 Passed:", report.scenarios.scenario6_add_links_later.passed);

    // =========================================================================
    // SCENARIO 7: Double-click & retry idempotency do NOT create duplicate clients
    // =========================================================================
    console.log("Running Scenario 7: Double-click & retry idempotency...");
    const idempClientName = `عميل عدم التكرار ${ts}`;
    await openModalAndFillBase(idempClientName);

    // Trigger rapid synchronous double click in DOM
    const [res7] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/clients") && r.request().method() === "POST", { timeout: 25000 }),
      page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("div.fixed button"));
        const submitBtn = btns.find((b) => (b.innerText || "").includes("إنشاء وتفعيل العميل"));
        submitBtn.click();
        submitBtn.click();
      }),
    ]);
    // Wait for the 900ms modal close timer + render to complete
    await delay(1600);

    const { data: dblClickClients } = await admin
      .from("clients")
      .select("id, name")
      .eq("workspace_id", testWsId)
      .eq("name", idempClientName);

    // Also test API-level retry with the exact same idempotencyKey
    const retryKey = `retry-test-key-${ts}`;
    const retryName = `عميل إعادة المحاولة ${ts}`;
    const retryResult = await page.evaluate(
      async ({ retryKey, retryName, designerId, copyId, strategyId }) => {
        const payload = {
          name: retryName,
          state: "Active",
          enableDesign: true,
          enableCopywriting: true,
          enableStrategy: true,
          requiresVideo: false,
          primaryDesignerId: designerId,
          primaryCopywriterId: copyId,
          primaryStrategistId: strategyId,
          strategyLeadId: strategyId,
          idempotencyKey: retryKey,
        };
        const r1 = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(async (r) => ({ status: r.status, body: await r.json() }));
        const r2 = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(async (r) => ({ status: r.status, body: await r.json() }));
        return { r1, r2 };
      },
      {
        retryKey,
        retryName,
        designerId: designerRoster.id,
        copyId: copyRoster.id,
        strategyId: strategyRoster.id,
      }
    );

    const { data: retryClients } = await admin
      .from("clients")
      .select("id, name")
      .eq("workspace_id", testWsId)
      .eq("name", retryName);

    report.scenarios.scenario7_double_click_and_retry_idempotency = {
      passed:
        dblClickClients?.length === 1 &&
        retryClients?.length === 1 &&
        retryResult.r1.body?.client?.id === retryResult.r2.body?.client?.id,
      uiDoubleClickRowCount: dblClickClients?.length,
      apiRetryRowCount: retryClients?.length,
      returnedSameClientId: retryResult.r1.body?.client?.id === retryResult.r2.body?.client?.id,
    };
    console.log("Scenario 7 Passed:", report.scenarios.scenario7_double_click_and_retry_idempotency.passed);

    // =========================================================================
    // SCENARIO 8: Required assignment failure does NOT leave a partially saved client
    // =========================================================================
    console.log("Running Scenario 8: Required assignment failure atomicity...");
    const atomicFailName = `عميل اختبار فشل الإسناد الذري ${ts}`;

    // 8A: UI validation when trying to activate without selecting a required track assignee
    await clickButtonByText("إضافة عميل جديد");
    await delay(500);
    await setReactInputValue('div.fixed input[placeholder*="Zen Coffee"]', 0, atomicFailName);
    await setReactInputValue("div.fixed select", 2, "");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/clients") && r.request().method() === "POST", { timeout: 25000 }),
      clickButtonByText("إنشاء وتفعيل العميل"),
    ]);
    await delay(400);

    const uiMissingAssigneeError = await page.evaluate(() => {
      const errBanner = document.querySelector("div.fixed .bg-rose-50");
      return errBanner ? errBanner.innerText : "";
    });
    await clickButtonByText("إلغاء");
    await delay(400);

    // 8B: Direct API call attempting to bypass UI and create an Active client with missing copywriter
    const apiAtomicFailRes = await page.evaluate(
      async ({ atomicFailName, designerId, strategyId }) => {
        const r = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: atomicFailName,
            state: "Active",
            enableDesign: true,
            enableCopywriting: true,
            enableStrategy: true,
            primaryDesignerId: designerId,
            primaryCopywriterId: null,
            strategyLeadId: strategyId,
          }),
        });
        return { status: r.status, body: await r.json() };
      },
      {
        atomicFailName,
        designerId: designerRoster.id,
        strategyId: strategyRoster.id,
      }
    );

    // 8C: API -> DB RPC call with an ineligible/non-existent copywriter UUID so failure happens inside public.create_client_atomic
    const rpcRollbackFailRes = await page.evaluate(
      async ({ atomicFailName, designerId, strategyId }) => {
        const r = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: atomicFailName,
            state: "Active",
            enableDesign: true,
            enableCopywriting: true,
            enableStrategy: true,
            primaryDesignerId: designerId,
            primaryCopywriterId: "00000000-0000-4000-8000-000000000999",
            primaryStrategistId: strategyId,
            strategyLeadId: strategyId,
          }),
        });
        return { status: r.status, body: await r.json() };
      },
      {
        atomicFailName,
        designerId: designerRoster.id,
        strategyId: strategyRoster.id,
      }
    );

    const { data: partialClientsInDb } = await admin
      .from("clients")
      .select("id, name")
      .eq("workspace_id", testWsId)
      .eq("name", atomicFailName);

    report.scenarios.scenario8_failed_assignment_no_partial_client = {
      passed:
        uiMissingAssigneeError.includes("المصمم الأساسي") &&
        apiAtomicFailRes.status === 400 &&
        apiAtomicFailRes.body?.error?.includes("كاتب المحتوى الأساسي") &&
        rpcRollbackFailRes.status === 400 &&
        rpcRollbackFailRes.body?.error?.includes("غير مؤهل") &&
        (partialClientsInDb?.length || 0) === 0,
      uiMissingAssigneeError,
      apiAtomicFailResponse: apiAtomicFailRes,
      rpcRollbackFailResponse: rpcRollbackFailRes,
      partialClientsCountInDb: partialClientsInDb?.length || 0,
    };
    console.log("Scenario 8 Passed:", report.scenarios.scenario8_failed_assignment_no_partial_client.passed);
  } finally {
    if (browser) {
      await browser.close();
    }
    if (testWsId) {
      console.log(`Cleaning up isolated test workspace ${testWsId}...`);
      await admin.from("rpc_idempotency_records").delete().eq("workspace_id", testWsId);
      await admin.from("audit_events").delete().eq("workspace_id", testWsId);
      await admin.from("client_briefs").delete().eq("workspace_id", testWsId);
      await admin.from("client_team_assignments").delete().eq("workspace_id", testWsId);
      await admin.from("clients").delete().eq("workspace_id", testWsId);
      await admin.from("workspace_memberships").delete().eq("workspace_id", testWsId);
      await admin.from("roster_people").delete().eq("workspace_id", testWsId);
      await admin.from("workspaces").delete().eq("id", testWsId);
    }
    if (ownerUserId) {
      await admin.auth.admin.deleteUser(ownerUserId);
    }
  }

  const { data: prodClientsAfter } = await admin
    .from("clients")
    .select("id, name, state")
    .eq("workspace_id", PROD_WS_ID);
  report.productionBaselineAfter = prodClientsAfter;

  const outPath = path.join(ARTIFACT_DIR, "client_creation_verification_results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log("Saved full verification report to:", outPath);

  const allPassed = Object.values(report.scenarios).every((s) => s.passed);
  if (!allPassed) {
    console.error("One or more scenarios failed:", JSON.stringify(report.scenarios, null, 2));
    process.exit(1);
  }
  console.log("ALL 8 SCENARIOS PASSED SUCCESSFULLY!");
}

run().catch((err) => {
  console.error("Fatal error in verification script:", err);
  process.exit(1);
});
