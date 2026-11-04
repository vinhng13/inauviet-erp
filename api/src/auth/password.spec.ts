import { generateTemporaryPassword, hashPassword, passwordProblem, verifyPassword } from './password';

describe('password', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('Inauviet@2026');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    await expect(verifyPassword('Inauviet@2026', hash)).resolves.toBe(true);
    await expect(verifyPassword('inauviet@2026', hash)).resolves.toBe(false);
    await expect(verifyPassword('x', null)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same-password')).not.toBe(await hashPassword('same-password'));
  });

  it('makes readable temporary passwords that pass the policy', () => {
    const p = generateTemporaryPassword();
    expect(p).toMatch(/^[a-zA-Z2-9]{10}$/);
    expect(passwordProblem(p)).toBeNull();
  });

  it('rejects weak passwords', () => {
    expect(passwordProblem('short')).not.toBeNull();
    expect(passwordProblem('12345678abc')).not.toBeNull();
    expect(passwordProblem('lan.nguyen-2026', 'lan.nguyen')).not.toBeNull();
    expect(passwordProblem('Xe-giao-hang-7')).toBeNull();
  });
});
