import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const VALID_KEY_HEX = 'a'.repeat(64);

function makeService(keyHex = VALID_KEY_HEX): CryptoService {
  const config = new ConfigService({ MASTER_KEY_HEX: keyHex });
  const svc = new CryptoService(config as unknown as ConfigService);
  svc.onModuleInit();
  return svc;
}

describe('CryptoService', () => {
  it('rejects a master key that is not 64 hex chars', () => {
    expect(() => makeService('short')).toThrow(/MASTER_KEY_HEX/);
    expect(() => makeService('g'.repeat(64))).toThrow(/MASTER_KEY_HEX/);
  });

  it('round-trips a plaintext PAT', async () => {
    const svc = makeService();
    const plain = 'ghp_1234567890abcdef_this_is_a_token';
    const enc = await svc.encryptPat(plain);
    expect(enc.iv).toHaveLength(12);
    expect(enc.authTag).toHaveLength(16);
    expect(enc.wrappedDek).toHaveLength(60);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    const out = await svc.decryptPat(enc);
    expect(out).toBe(plain);
  });

  it('uses a fresh iv and wrapped dek per encryption', async () => {
    const svc = makeService();
    const a = await svc.encryptPat('secret-1');
    const b = await svc.encryptPat('secret-1');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('rejects tampered ciphertext', async () => {
    const svc = makeService();
    const enc = await svc.encryptPat('tamper-me');
    const ct = Buffer.from(enc.ciphertext);
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    await expect(svc.decryptPat({ ...enc, ciphertext: ct })).rejects.toThrow();
  });

  it('rejects tampered auth tag', async () => {
    const svc = makeService();
    const enc = await svc.encryptPat('tamper-me');
    const tag = Buffer.from(enc.authTag);
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    await expect(svc.decryptPat({ ...enc, authTag: tag })).rejects.toThrow();
  });

  it('rejects tampered wrapped dek', async () => {
    const svc = makeService();
    const enc = await svc.encryptPat('tamper-me');
    const wrapped = Buffer.from(enc.wrappedDek);
    wrapped[20] = (wrapped[20] ?? 0) ^ 0xff;
    await expect(svc.decryptPat({ ...enc, wrappedDek: wrapped })).rejects.toThrow();
  });

  it('fails to decrypt with the wrong master key', async () => {
    const svcA = makeService('a'.repeat(64));
    const svcB = makeService('b'.repeat(64));
    const enc = await svcA.encryptPat('cross-key');
    await expect(svcB.decryptPat(enc)).rejects.toThrow();
  });

  it('rejects empty or non-string plaintext', async () => {
    const svc = makeService();
    await expect(svc.encryptPat('')).rejects.toThrow();
    // @ts-expect-error runtime check
    await expect(svc.encryptPat(null)).rejects.toThrow();
  });

  it('rejects malformed blob shapes', async () => {
    const svc = makeService();
    const enc = await svc.encryptPat('x');
    await expect(
      svc.decryptPat({ ...enc, iv: Buffer.alloc(11) }),
    ).rejects.toThrow(/iv/);
    await expect(
      svc.decryptPat({ ...enc, authTag: Buffer.alloc(15) }),
    ).rejects.toThrow(/auth tag/);
    await expect(
      svc.decryptPat({ ...enc, wrappedDek: Buffer.alloc(59) }),
    ).rejects.toThrow(/wrapped dek/);
  });
});
