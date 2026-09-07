import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const TOKEN_FILE_NAME = ".owner-setup-token";

export function getSetupTokenFilePath(): string {
  return path.join(process.cwd(), TOKEN_FILE_NAME);
}

/**
 * Retrieves the existing setup token from .owner-setup-token,
 * or generates a new cryptographically secure 64-character token if not present.
 */
export function getOrCreateSetupToken(): string {
  const filePath = getSetupTokenFilePath();
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8").trim();
    if (existing.length >= 32) {
      return existing;
    }
  }

  const newToken = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(filePath, newToken + "\n", { encoding: "utf-8" });
  return newToken;
}

/**
 * Validates the provided token against .owner-setup-token using constant-time comparison.
 * If valid, immediately unlinks the file to ensure the token cannot be reused (one-time setup).
 */
export function validateAndConsumeSetupToken(providedToken: string): boolean {
  const filePath = getSetupTokenFilePath();
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const storedToken = fs.readFileSync(filePath, "utf-8").trim();
    if (!storedToken || !providedToken) {
      return false;
    }

    const storedBuf = Buffer.from(storedToken, "utf-8");
    const providedBuf = Buffer.from(providedToken.trim(), "utf-8");

    if (storedBuf.length !== providedBuf.length) {
      return false;
    }

    const match = crypto.timingSafeEqual(storedBuf, providedBuf);
    if (match) {
      // Consume the token: delete file immediately
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn("Could not delete .owner-setup-token:", err);
      }
      return true;
    }

    return false;
  } catch (err) {
    console.error("Error validating setup token:", err);
    return false;
  }
}

/**
 * Checks whether an active owner already exists in workspace_memberships.
 */
export async function hasExistingOwner(adminClient: SupabaseClient): Promise<boolean> {
  const { data, error } = await adminClient
    .from("workspace_memberships")
    .select("id")
    .eq("role", "owner")
    .eq("is_active", true)
    .limit(1);

  if (error) {
    console.error("Error checking existing owner membership:", error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}
