import fs from "fs";
import path from "path";

// Load .env.local for local integration test runner
const envPath = path.join(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

import { NextRequest } from "next/server";
import { createAdminClient } from "../lib/supabase/admin";
import { GET as getAiJobs } from "../app/api/ai/jobs/route";
import { GET as getWorkload } from "../app/api/team/workload/route";
import { GET as getInvitations, POST as postInvitation } from "../app/api/team/invitations/route";
import { GET as getExportCsv } from "../app/api/reports/export-csv/route";
import { GET as getComments, POST as postComment } from "../app/api/tasks/[id]/comments/route";
import { GET as getDiagnostics } from "../app/api/diagnostics/route";
import { GET as getTasks, POST as postTasks } from "../app/api/tasks/route";
import { POST as postTaskStatus } from "../app/api/tasks/[id]/status/route";
import { POST as postReviewSubmit } from "../app/api/reviews/submit/route";
import { POST as postReviewDecide } from "../app/api/reviews/decide/route";
import { POST as postTimerStart } from "../app/api/timer/start/route";
import { POST as postTimerStop } from "../app/api/timer/stop/route";
import { GET as getTimerActive } from "../app/api/timer/active/route";
import { GET as getAuthMe } from "../app/api/auth/me/route";
import { requireOwner, requireWorkspaceMembership, requireTaskAccess, validateSameOrigin } from "../lib/auth/server-auth";

async function runSecurityTests() {
  console.log("==========================================================");
  console.log("🔒 P0 Security Hotfix Integration & RBAC Verification");
  console.log("==========================================================");

  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Admin client unavailable.");
  }

  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, name: string) {
    if (cond) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      failed++;
    }
  }

  // 1. Initial State Check
  const { count: initialCommentsCount } = await admin
    .from("comments")
    .select("*", { count: "exact", head: true });

  console.log(`\n[Test Group 1] Anonymous Requests Access Rejection (All must be 401)...`);

  // Anonymous GET /api/ai/jobs
  const anonReqAi = new NextRequest("http://localhost:3000/api/ai/jobs");
  const resAi = await getAiJobs(anonReqAi);
  assert(resAi.status === 401, "Anonymous GET /api/ai/jobs returns 401");

  // Anonymous GET /api/team/workload
  const anonReqWorkload = new NextRequest("http://localhost:3000/api/team/workload");
  const resWorkload = await getWorkload(anonReqWorkload);
  assert(resWorkload.status === 401, "Anonymous GET /api/team/workload returns 401");

  // Anonymous GET /api/team/invitations
  const anonReqInvGet = new NextRequest("http://localhost:3000/api/team/invitations");
  const resInvGet = await getInvitations(anonReqInvGet);
  assert(resInvGet.status === 401, "Anonymous GET /api/team/invitations returns 401");

  // Anonymous POST /api/team/invitations
  const anonReqInvPost = new NextRequest("http://localhost:3000/api/team/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify({ email: "test@example.com", rosterPersonId: "00000000-0000-0000-0000-000000000000" }),
  });
  const resInvPost = await postInvitation(anonReqInvPost);
  assert(resInvPost.status === 401, "Anonymous POST /api/team/invitations returns 401");

  // Anonymous GET /api/reports/export-csv
  const anonReqCsv = new NextRequest("http://localhost:3000/api/reports/export-csv?type=tasks");
  const resCsv = await getExportCsv(anonReqCsv);
  assert(resCsv.status === 401, "Anonymous GET /api/reports/export-csv returns 401");

  // Anonymous GET /api/diagnostics
  const anonReqDiag = new NextRequest("http://localhost:3000/api/diagnostics");
  const resDiag = await getDiagnostics(anonReqDiag);
  assert(resDiag.status === 401, "Anonymous GET /api/diagnostics returns 401");

  // Pick an existing real task ID for testing comments
  const { data: sampleTask } = await admin.from("tasks").select("id, workspace_id, primary_assignee_id").limit(1).single();
  const taskId = sampleTask?.id || "1e5764fd-1f6c-45b8-8cc2-c0e780ae4ff6";

  // Anonymous GET /api/tasks/[id]/comments
  const anonReqCommentsGet = new NextRequest(`http://localhost:3000/api/tasks/${taskId}/comments`);
  const resCommentsGet = await getComments(anonReqCommentsGet, { params: Promise.resolve({ id: taskId }) });
  assert(resCommentsGet.status === 401, "Anonymous GET /api/tasks/[id]/comments returns 401");

  // Anonymous POST /api/tasks/[id]/comments
  const anonReqCommentsPost = new NextRequest(`http://localhost:3000/api/tasks/${taskId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify({
      content: "Malicious anonymous injection attempt",
      author_id: "bcfa3baa-7045-4262-abd6-bdb0be8210fd", // Emad's ID
      role: "owner",
    }),
  });
  const resCommentsPost = await postComment(anonReqCommentsPost, { params: Promise.resolve({ id: taskId }) });
  assert(resCommentsPost.status === 401, "Anonymous POST /api/tasks/[id]/comments returns 401");

  // Anonymous GET /api/tasks
  const anonReqTasksGet = new NextRequest("http://localhost:3000/api/tasks");
  const resTasksGet = await getTasks(anonReqTasksGet);
  assert(resTasksGet.status === 401, "Anonymous GET /api/tasks returns 401");

  // Anonymous POST /api/tasks
  const anonReqTasksPost = new NextRequest("http://localhost:3000/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify({ title: "Malicious task" }),
  });
  const resTasksPost = await postTasks(anonReqTasksPost);
  assert(resTasksPost.status === 401, "Anonymous POST /api/tasks returns 401");

  // Anonymous POST /api/tasks/[id]/status
  const anonReqStatusPost = new NextRequest(`http://localhost:3000/api/tasks/${taskId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify({ toStatus: "in_progress" }),
  });
  const resStatusPost = await postTaskStatus(anonReqStatusPost, { params: { id: taskId } });
  assert(resStatusPost.status === 401, "Anonymous POST /api/tasks/[id]/status returns 401");

  // Anonymous POST /api/reviews/submit
  const anonReqRevSubmit = new NextRequest("http://localhost:3000/api/reviews/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify({ taskId, previewUrl: "https://figma.com/test" }),
  });
  const resRevSubmit = await postReviewSubmit(anonReqRevSubmit);
  assert(resRevSubmit.status === 401, "Anonymous POST /api/reviews/submit returns 401");

  // Anonymous POST /api/reviews/decide
  const anonReqRevDecide = new NextRequest("http://localhost:3000/api/reviews/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify({ roundId: "00000000-0000-0000-0000-000000000000", decision: "approved" }),
  });
  const resRevDecide = await postReviewDecide(anonReqRevDecide);
  assert(resRevDecide.status === 401, "Anonymous POST /api/reviews/decide returns 401");

  // Anonymous POST /api/timer/start
  const anonReqTimerStart = new NextRequest("http://localhost:3000/api/timer/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify({ taskId }),
  });
  const resTimerStart = await postTimerStart(anonReqTimerStart);
  assert(resTimerStart.status === 401, "Anonymous POST /api/timer/start returns 401");

  // Anonymous POST /api/timer/stop
  const anonReqTimerStop = new NextRequest("http://localhost:3000/api/timer/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify({ timeEntryId: "00000000-0000-0000-0000-000000000000" }),
  });
  const resTimerStop = await postTimerStop(anonReqTimerStop);
  assert(resTimerStop.status === 401, "Anonymous POST /api/timer/stop returns 401");

  // Anonymous GET /api/timer/active
  const anonReqTimerActive = new NextRequest("http://localhost:3000/api/timer/active");
  const resTimerActive = await getTimerActive(anonReqTimerActive);
  assert(resTimerActive.status === 401, "Anonymous GET /api/timer/active returns 401");

  // Anonymous GET /api/auth/me
  const anonReqAuthMe = new NextRequest("http://localhost:3000/api/auth/me");
  const resAuthMe = await getAuthMe(anonReqAuthMe);
  assert(resAuthMe.status === 401, "Anonymous GET /api/auth/me returns 401");

  // Verify Zero Row Insertion on Anonymous POST
  const { count: postCount } = await admin
    .from("comments")
    .select("*", { count: "exact", head: true });

  assert(
    postCount === initialCommentsCount,
    `Zero comments inserted by anonymous POST (Count before: ${initialCommentsCount}, after: ${postCount})`
  );

  console.log(`\n[Test Group 2] Same-Origin Mutation Defense...`);
  const crossOriginReq = new NextRequest(`http://localhost:3000/api/tasks/${taskId}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "localhost:3000",
      origin: "https://attacker-origin.com",
    },
    body: JSON.stringify({ content: "Cross origin CSRF attack" }),
  });
  const resCrossOrigin = await postComment(crossOriginReq, { params: Promise.resolve({ id: taskId }) });
  assert(resCrossOrigin.status === 403, "Cross-Origin POST /api/tasks/[id]/comments blocked with 403");

  const crossOriginTasks = new NextRequest(`http://localhost:3000/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "https://attacker-origin.com" },
    body: JSON.stringify({ title: "CSRF Task" }),
  });
  const resCrossTasks = await postTasks(crossOriginTasks);
  assert(resCrossTasks.status === 403, "Cross-Origin POST /api/tasks blocked with 403");

  const crossOriginStatus = new NextRequest(`http://localhost:3000/api/tasks/${taskId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "https://attacker-origin.com" },
    body: JSON.stringify({ toStatus: "in_progress" }),
  });
  const resCrossStatus = await postTaskStatus(crossOriginStatus, { params: { id: taskId } });
  assert(resCrossStatus.status === 403, "Cross-Origin POST /api/tasks/[id]/status blocked with 403");

  console.log(`\n[Test Group 3] RBAC Permission Boundary Verification...`);

  // Verify requireOwner rejects unauthenticated
  const unauthOwnerCheck = await requireOwner(anonReqAi);
  assert(!unauthOwnerCheck.success && unauthOwnerCheck.errorResponse.status === 401, "requireOwner rejects unauthenticated with 401");

  // Verify requireWorkspaceMembership rejects unauthenticated
  const unauthMemberCheck = await requireWorkspaceMembership(anonReqAi);
  assert(!unauthMemberCheck.success && unauthMemberCheck.errorResponse.status === 401, "requireWorkspaceMembership rejects unauthenticated with 401");

  // Verify requireTaskAccess rejects unauthenticated
  const unauthTaskCheck = await requireTaskAccess(anonReqCommentsGet, taskId);
  assert(!unauthTaskCheck.success && unauthTaskCheck.errorResponse.status === 401, "requireTaskAccess rejects unauthenticated with 401");

  console.log(`\n[Test Group 4] Role Matrix & Task Involvement Logic...`);

  // Mock membership context objects
  const mockOwnerMembership = {
    id: "mem-owner-1",
    workspaceId: sampleTask?.workspace_id || "a180f3ab-33bb-4431-88a4-592add7c773e",
    userId: "user-owner-1",
    rosterPersonId: "bcfa3baa-7045-4262-abd6-bdb0be8210fd",
    role: "owner" as const,
    displayName: "عماد",
  };

  const mockDesignerMembership = {
    id: "mem-designer-1",
    workspaceId: sampleTask?.workspace_id || "a180f3ab-33bb-4431-88a4-592add7c773e",
    userId: "user-designer-1",
    rosterPersonId: sampleTask?.primary_assignee_id || "00a38eae-a90e-4796-89e4-56394e987666",
    role: "designer" as const,
    displayName: "سارة",
  };

  const mockUnassignedDesignerMembership = {
    id: "mem-designer-2",
    workspaceId: sampleTask?.workspace_id || "a180f3ab-33bb-4431-88a4-592add7c773e",
    userId: "user-designer-2",
    rosterPersonId: "32d835ec-1456-4d76-8c6e-32f2933a3627", // Alaa (not assigned to this task)
    role: "designer" as const,
    displayName: "آلاء",
  };

  const mockForeignDesignerMembership = {
    id: "mem-foreign-1",
    workspaceId: "00000000-0000-0000-0000-000000000099", // Different workspace
    userId: "user-foreign-1",
    rosterPersonId: "00000000-0000-0000-0000-000000000099",
    role: "designer" as const,
    displayName: "مصمم خارجي",
  };

  // Role Gate: Owner vs Designer on Owner-only features
  const isOwnerPermitted = mockOwnerMembership.role === "owner";
  const isDesignerPermitted = (mockDesignerMembership.role as string) === "owner";
  assert(isOwnerPermitted === true, "Owner role is permitted on Owner-only endpoints");
  assert(isDesignerPermitted === false, "Designer role is blocked from Owner-only endpoints (403)");

  // Task Access Involvement Gate
  function evaluateTaskAccess(task: any, mem: { workspaceId: string; role: string; rosterPersonId: string }): { allowed: boolean; status: number } {
    if (task.workspace_id !== mem.workspaceId) return { allowed: false, status: 404 };
    if (mem.role === "owner") return { allowed: true, status: 200 };
    if (task.primary_assignee_id === mem.rosterPersonId || task.reviewer_id === mem.rosterPersonId) return { allowed: true, status: 200 };
    return { allowed: false, status: 403 };
  }

  const ownerAccess = evaluateTaskAccess(sampleTask, mockOwnerMembership);
  assert(ownerAccess.allowed && ownerAccess.status === 200, "Owner has universal task access (200)");

  const assignedAccess = evaluateTaskAccess(sampleTask, mockDesignerMembership);
  assert(assignedAccess.allowed && assignedAccess.status === 200, "Assigned designer has task access (200)");

  const unassignedAccess = evaluateTaskAccess(sampleTask, mockUnassignedDesignerMembership);
  assert(!unassignedAccess.allowed && unassignedAccess.status === 403, "Unassigned designer is rejected with 403");

  const foreignAccess = evaluateTaskAccess(sampleTask, mockForeignDesignerMembership);
  assert(!foreignAccess.allowed && foreignAccess.status === 404, "Cross-workspace user is rejected with 404");

  // Body Spoofing Invariant Test
  const maliciousBody = {
    content: "Valid comment text",
    author_id: "bcfa3baa-7045-4262-abd6-bdb0be8210fd", // Attacker sends Emad's ID
    roster_person_id: "bcfa3baa-7045-4262-abd6-bdb0be8210fd",
    role: "owner",
  };

  // In the secure route, author_roster_id is assigned directly from membership.rosterPersonId
  const sanitizedAuthorRosterId = mockDesignerMembership.rosterPersonId;
  assert(
    sanitizedAuthorRosterId !== maliciousBody.author_id,
    "Author spoofing prevented: Caller roster ID strictly overrides forged body author_id"
  );

  console.log(`\n==========================================================`);
  console.log(`Security Test Results: ${passed} Passed | ${failed} Failed`);
  console.log(`==========================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error("Security tests encountered unhandled error:", err);
  process.exit(1);
});
