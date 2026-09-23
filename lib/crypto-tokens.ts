import crypto from "crypto";

// Derive 32-byte key from server-side environment secrets
function getEncryptionKey(): Buffer {
  const secret =
    process.env.AI_WORKER_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "omg-default-server-encryption-key-fallback";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Computes SHA-256 hex digest of a raw token.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Encrypts a raw token with AES-256-GCM.
 * Output format: iv_hex:authTag_hex:ciphertext_hex
 */
export function encryptToken(plainText: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted token.
 * Returns null if decryption fails or authentication tag does not match.
 */
export function decryptToken(cipherText: string | null | undefined): string | null {
  if (!cipherText || typeof cipherText !== "string") return null;
  try {
    const parts = cipherText.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Generates a 64-char hex cryptographically secure token.
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Validates a plain token against an expected SHA-256 hash.
 */
export function verifyToken(token: string, expectedHash: string): boolean {
  if (!token || !expectedHash) return false;
  return hashToken(token) === expectedHash;
}

/**
 * Generates a high-entropy cryptographically secure invitation token,
 * its SHA-256 hash for database queries, and its ciphertext for storage.
 */
export function generateInvitationToken(): {
  rawToken: string;
  tokenHash: string;
  encryptedToken: string;
} {
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const encryptedToken = encryptToken(rawToken);
  return { rawToken, tokenHash, encryptedToken };
}
