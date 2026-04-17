import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import type {
  EncryptedPat,
  ICryptoService,
} from '@moulinator/api-core-contracts';

const MASTER_KEY_BYTES = 32;
const DEK_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const WRAPPED_DEK_BYTES = IV_BYTES + DEK_BYTES + TAG_BYTES; // 60

@Injectable()
export class CryptoService implements ICryptoService, OnModuleInit {
  private masterKey!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const hex = this.config.get<string>('MASTER_KEY_HEX');
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(
        'MASTER_KEY_HEX must be exactly 64 hex characters (32 bytes)',
      );
    }
    this.masterKey = Buffer.from(hex, 'hex');
  }

  async encryptPat(plaintext: string): Promise<EncryptedPat> {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('plaintext must be a non-empty string');
    }

    const dek = randomBytes(DEK_BYTES);
    const iv = randomBytes(IV_BYTES);
    try {
      const cipher = createCipheriv('aes-256-gcm', dek, iv);
      const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(plaintext, 'utf8')),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      const wrapIv = randomBytes(IV_BYTES);
      const wrapCipher = createCipheriv('aes-256-gcm', this.masterKey, wrapIv);
      const wrappedDekBody = Buffer.concat([
        wrapCipher.update(dek),
        wrapCipher.final(),
      ]);
      const wrapTag = wrapCipher.getAuthTag();
      const wrappedDek = Buffer.concat([wrapIv, wrappedDekBody, wrapTag]);

      return { ciphertext, iv, authTag, wrappedDek };
    } finally {
      dek.fill(0);
    }
  }

  async decryptPat(blob: EncryptedPat): Promise<string> {
    if (
      !Buffer.isBuffer(blob.ciphertext) ||
      !Buffer.isBuffer(blob.iv) ||
      !Buffer.isBuffer(blob.authTag) ||
      !Buffer.isBuffer(blob.wrappedDek)
    ) {
      throw new Error('encrypted pat blob must have Buffer fields');
    }
    if (blob.iv.length !== IV_BYTES) throw new Error('invalid iv length');
    if (blob.authTag.length !== TAG_BYTES)
      throw new Error('invalid auth tag length');
    if (blob.wrappedDek.length !== WRAPPED_DEK_BYTES)
      throw new Error('invalid wrapped dek length');

    const wrapIv = blob.wrappedDek.subarray(0, IV_BYTES);
    const wrappedBody = blob.wrappedDek.subarray(IV_BYTES, IV_BYTES + DEK_BYTES);
    const wrapTag = blob.wrappedDek.subarray(IV_BYTES + DEK_BYTES);

    const unwrap = createDecipheriv('aes-256-gcm', this.masterKey, wrapIv);
    unwrap.setAuthTag(wrapTag);
    const dek = Buffer.concat([unwrap.update(wrappedBody), unwrap.final()]);
    try {
      const dec = createDecipheriv('aes-256-gcm', dek, blob.iv);
      dec.setAuthTag(blob.authTag);
      const plain = Buffer.concat([dec.update(blob.ciphertext), dec.final()]);
      return plain.toString('utf8');
    } finally {
      dek.fill(0);
    }
  }

  /** Internal: compare two Buffers constant-time (exposed for tests). */
  static equal(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
