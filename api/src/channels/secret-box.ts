import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from '../common/errors/domain-error';

/** Reads CHANNEL_SECRET_KEY: 32 bytes written as 64 hex characters or as base64. */
export function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const text = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  return key.length === 32 ? key : null;
}

/**
 * AES-256-GCM for access tokens at rest. Output: "v1.<iv>.<tag>.<ciphertext>" in base64url.
 * Without a valid key nothing can be stored, so connecting a channel fails with CHANNEL_KEY_MISSING.
 */
export class SecretBox {
  constructor(private readonly key: Buffer | null) {}

  get ready(): boolean {
    return this.key !== null;
  }

  seal(plain: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), body].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  open(sealed: string): string {
    const key = this.requireKey();
    const [version, iv, tag, body] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || body === undefined) throw new Error('Unknown sealed token format');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw DomainError.badRequest('CHANNEL_KEY_MISSING', 'CHANNEL_SECRET_KEY is not set (32 bytes, hex or base64)');
    }
    return this.key;
  }
}
