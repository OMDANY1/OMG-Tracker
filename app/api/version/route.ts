import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Fallback build identifier
const BUILD_TIME = new Date().toISOString();

export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    BUILD_TIME;

  return NextResponse.json({
    version,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "development",
    timestamp: BUILD_TIME,
  });
}
