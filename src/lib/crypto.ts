import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { getConfig } from "@/lib/config";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Cache the derived key — scryptSync is deliberately expensive (~50-100ms)
// and the key+salt never change during a process lifetime.
let _derivedKey: Buffer | null = null;

function getKey(): Buffer {
  if (_derivedKey) return _derivedKey;
  const config = getConfig();
  const secret = config.encryptionKey;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  const salt = config.encryptionSalt;
  _derivedKey = scryptSync(secret, salt, KEY_LENGTH);
  return _derivedKey;
}

/** Clear cached derived key. Used by tests alongside resetConfig(). */
export function resetDerivedKey(): void {
  _derivedKey = null;
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns: iv:authTag:encryptedData (all base64)
 */
export function encrypt(text: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with encrypt()
 */
export function decrypt(encryptedText: string): string {
  const key = getKey();
  const parts = encryptedText.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }

  const [ivBase64, authTagBase64, encrypted] = parts;
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
