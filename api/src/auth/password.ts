import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Passwords are hashed with scrypt (built into Node, no native add-on to compile on Windows).
 * Stored format: scrypt$N$r$p$<salt base64>$<hash base64>
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await derive(password, Buffer.from(saltB64, 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Used to make a failed lookup take as long as a real check, so timing doesn't reveal which usernames exist. */
export const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

/** Temporary password a person can read out or type: 10 characters, no look-alikes (0/O, 1/l/I). */
export function generateTemporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export const PASSWORD_MIN_LENGTH = 8;

/** Returns a reason when the password is too weak, otherwise null. */
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự`;
  if (password.length > 200) return 'Mật khẩu quá dài';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'Mật khẩu không được chứa tên đăng nhập';
  if (/^(.)\1+$/.test(password) || /^(12345678|password|matkhau)/i.test(password)) return 'Mật khẩu quá dễ đoán';
  return null;
}
