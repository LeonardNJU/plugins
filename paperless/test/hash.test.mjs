import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { md5Hex, sha256Hex, checksums } from '../src/lib/hash.js';

const node = (alg, data) => createHash(alg).update(data).digest('hex');

describe('hash', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('matches node:crypto across block boundaries and for binary data', () => {
    for (const size of [55, 56, 63, 64, 65, 119, 120, 1000, 70_000]) {
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = (i * 31 + size) & 0xff;
      expect(sha256Hex(data), `sha256 ${size}`).toBe(node('sha256', data));
      expect(md5Hex(data), `md5 ${size}`).toBe(node('md5', data));
    }
  });

  it('takes an ArrayBuffer and gives both sums', () => {
    const data = new TextEncoder().encode('%PDF-1.4 hello').buffer;
    expect(checksums(data)).toEqual({ sha256: node('sha256', Buffer.from(data)), md5: node('md5', Buffer.from(data)) });
  });
});
