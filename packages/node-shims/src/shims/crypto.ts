// Minimal Node-compatible `crypto` shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained. Backed entirely by the WebCrypto APIs
// (`crypto.subtle`, `crypto.getRandomValues`, `crypto.randomUUID`) that are
// available as globals in WKWebView (and in Node, which is what vitest runs
// under). MD5 is intentionally unsupported — WebCrypto does not implement it.

import { Buffer } from "./buffer.js";

// `crypto` is a global in both browsers/WKWebView and modern Node, but the
// ES2020 lib (no DOM) doesn't declare its shape — add a minimal ambient
// declaration local to this module, matching only what we use here.
interface SubtleCryptoLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  sign(
    algorithm: string | { name: string },
    key: unknown,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
  importKey(
    format: string,
    keyData: Uint8Array,
    algorithm: unknown,
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>;
  deriveBits(
    algorithm: unknown,
    baseKey: unknown,
    length: number,
  ): Promise<ArrayBuffer>;
  encrypt(
    algorithm: unknown,
    key: unknown,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
  decrypt(
    algorithm: unknown,
    key: unknown,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
}

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): string;
  subtle: SubtleCryptoLike;
}

declare const crypto: CryptoLike;

// Maps Node's lowercase hash algorithm names to WebCrypto's digest names.
const HASH_ALGORITHMS: Record<string, string> = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
  "sha-1": "SHA-1",
  "sha-256": "SHA-256",
  "sha-384": "SHA-384",
  "sha-512": "SHA-512",
};

// Maps Node's cipher algorithm names to WebCrypto's algorithm name + key
// length (in bytes) implied by the algorithm's bit-length component.
const CIPHER_ALGORITHMS: Record<string, { webcrypto: string; keyLength: number }> = {
  "aes-128-cbc": { webcrypto: "AES-CBC", keyLength: 16 },
  "aes-192-cbc": { webcrypto: "AES-CBC", keyLength: 24 },
  "aes-256-cbc": { webcrypto: "AES-CBC", keyLength: 32 },
  "aes-128-gcm": { webcrypto: "AES-GCM", keyLength: 16 },
  "aes-192-gcm": { webcrypto: "AES-GCM", keyLength: 24 },
  "aes-256-gcm": { webcrypto: "AES-GCM", keyLength: 32 },
  "aes-128-ctr": { webcrypto: "AES-CTR", keyLength: 16 },
  "aes-192-ctr": { webcrypto: "AES-CTR", keyLength: 24 },
  "aes-256-ctr": { webcrypto: "AES-CTR", keyLength: 32 },
};

function resolveHashAlgorithm(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "md5") {
    throw new Error("md5 is not supported — use sha256 or higher");
  }
  const resolved = HASH_ALGORITHMS[lower];
  if (!resolved) {
    throw new Error(`Unsupported hash algorithm: ${name}`);
  }
  return resolved;
}

function resolveCipherAlgorithm(
  name: string,
): { webcrypto: string; keyLength: number } {
  const resolved = CIPHER_ALGORITHMS[name.toLowerCase()];
  if (!resolved) {
    throw new Error(`Unsupported cipher algorithm: ${name}`);
  }
  return resolved;
}

type BufferLike = Buffer | Uint8Array | string;

function toUint8Array(data: BufferLike, encoding?: string): Uint8Array {
  if (typeof data === "string") {
    return Buffer.from(data, encoding)._buf;
  }
  if (Buffer.isBuffer(data)) {
    return (data as Buffer)._buf;
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  throw new TypeError("Expected string, Buffer, or Uint8Array");
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeDigest(
  bytes: Uint8Array,
  encoding?: string,
): Buffer | string {
  const buf = Buffer.from(bytes);
  if (!encoding) return buf;
  return buf.toString(encoding as never);
}

export class Hash {
  _algorithm: string;
  _data: Uint8Array[] = [];

  constructor(algorithm: string) {
    this._algorithm = resolveHashAlgorithm(algorithm);
  }

  update(data: BufferLike, encoding?: string): this {
    this._data.push(toUint8Array(data, encoding));
    return this;
  }

  async digest(encoding?: string): Promise<Buffer | string> {
    const combined = concatUint8Arrays(this._data);
    const result = await crypto.subtle.digest(this._algorithm, combined);
    return encodeDigest(new Uint8Array(result), encoding);
  }
}

export class Hmac {
  _algorithm: string;
  _key: Uint8Array;
  _data: Uint8Array[] = [];

  constructor(algorithm: string, key: BufferLike) {
    this._algorithm = resolveHashAlgorithm(algorithm);
    this._key = toUint8Array(key);
  }

  update(data: BufferLike, encoding?: string): this {
    this._data.push(toUint8Array(data, encoding));
    return this;
  }

  async digest(encoding?: string): Promise<Buffer | string> {
    const combined = concatUint8Arrays(this._data);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      this._key,
      { name: "HMAC", hash: this._algorithm },
      false,
      ["sign"],
    );
    const result = await crypto.subtle.sign("HMAC", cryptoKey, combined);
    return encodeDigest(new Uint8Array(result), encoding);
  }
}

function cipherParams(
  webcryptoName: string,
  iv: Uint8Array,
): Record<string, unknown> {
  if (webcryptoName === "AES-CBC") {
    return { name: "AES-CBC", iv };
  }
  if (webcryptoName === "AES-GCM") {
    return { name: "AES-GCM", iv, tagLength: 128 };
  }
  if (webcryptoName === "AES-CTR") {
    return { name: "AES-CTR", counter: iv, length: 64 };
  }
  throw new Error(`Unsupported cipher algorithm: ${webcryptoName}`);
}

export class Cipher {
  _webcrypto: string;
  _key: Uint8Array;
  _iv: Uint8Array;
  _data: Uint8Array[] = [];
  _authTag: Buffer | null = null;

  constructor(algorithm: string, key: BufferLike, iv: BufferLike) {
    const resolved = resolveCipherAlgorithm(algorithm);
    this._webcrypto = resolved.webcrypto;
    this._key = toUint8Array(key);
    this._iv = toUint8Array(iv);
  }

  async update(data: BufferLike, inputEncoding?: string): Promise<Buffer> {
    this._data.push(toUint8Array(data, inputEncoding));
    return Buffer.alloc(0);
  }

  async final(): Promise<Buffer> {
    const combined = concatUint8Arrays(this._data);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      this._key,
      { name: this._webcrypto },
      false,
      ["encrypt"],
    );
    const params = cipherParams(this._webcrypto, this._iv);
    const result = new Uint8Array(
      await crypto.subtle.encrypt(params, cryptoKey, combined),
    );

    if (this._webcrypto === "AES-GCM") {
      const tagStart = result.length - 16;
      this._authTag = Buffer.from(result.slice(tagStart));
      return Buffer.from(result.slice(0, tagStart));
    }
    return Buffer.from(result);
  }

  getAuthTag(): Buffer {
    if (this._webcrypto !== "AES-GCM") {
      throw new Error("getAuthTag is only supported for GCM mode");
    }
    if (!this._authTag) {
      throw new Error("getAuthTag can only be called after final()");
    }
    return this._authTag;
  }
}

export class Decipher {
  _webcrypto: string;
  _key: Uint8Array;
  _iv: Uint8Array;
  _data: Uint8Array[] = [];
  _authTag: Uint8Array | null = null;

  constructor(algorithm: string, key: BufferLike, iv: BufferLike) {
    const resolved = resolveCipherAlgorithm(algorithm);
    this._webcrypto = resolved.webcrypto;
    this._key = toUint8Array(key);
    this._iv = toUint8Array(iv);
  }

  async update(data: BufferLike, inputEncoding?: string): Promise<Buffer> {
    this._data.push(toUint8Array(data, inputEncoding));
    return Buffer.alloc(0);
  }

  setAuthTag(tag: BufferLike): this {
    this._authTag = toUint8Array(tag);
    return this;
  }

  async final(): Promise<Buffer> {
    let combined = concatUint8Arrays(this._data);
    if (this._webcrypto === "AES-GCM" && this._authTag) {
      combined = concatUint8Arrays([combined, this._authTag]);
    }
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      this._key,
      { name: this._webcrypto },
      false,
      ["decrypt"],
    );
    const params = cipherParams(this._webcrypto, this._iv);
    const result = await crypto.subtle.decrypt(params, cryptoKey, combined);
    return Buffer.from(new Uint8Array(result));
  }
}

export function randomBytes(size: number): Buffer {
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  return Buffer.from(arr);
}

export function randomFillSync<T extends Buffer | Uint8Array>(
  buf: T,
  offset = 0,
  size?: number,
): T {
  const raw = Buffer.isBuffer(buf) ? (buf as unknown as Buffer)._buf : (buf as Uint8Array);
  const len = size ?? raw.length - offset;
  const view = raw.subarray(offset, offset + len);
  crypto.getRandomValues(view);
  return buf;
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

export function randomInt(minOrMax: number, max?: number): number {
  const min = max === undefined ? 0 : minOrMax;
  const upper = max === undefined ? minOrMax : max;
  const range = upper - min;
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return min + (arr[0] % range);
}

export function timingSafeEqual(
  a: Buffer | Uint8Array,
  b: Buffer | Uint8Array,
): boolean {
  const bytesA = Buffer.isBuffer(a) ? (a as unknown as Buffer)._buf : (a as Uint8Array);
  const bytesB = Buffer.isBuffer(b) ? (b as unknown as Buffer)._buf : (b as Uint8Array);
  if (bytesA.length !== bytesB.length) {
    throw new RangeError("Input buffers must have the same byte length");
  }
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

export function pbkdf2(
  password: BufferLike,
  salt: BufferLike,
  iterations: number,
  keylen: number,
  digest: string,
  callback: (err: Error | null, derivedKey: Buffer) => void,
): void {
  (async () => {
    const passwordBytes = toUint8Array(password);
    const saltBytes = toUint8Array(salt);
    const hashAlgorithm = resolveHashAlgorithm(digest);
    const baseKey = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations, hash: hashAlgorithm },
      baseKey,
      keylen * 8,
    );
    return Buffer.from(new Uint8Array(bits));
  })().then(
    (result) => callback(null, result),
    (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)),
  );
}

export function createHash(algorithm: string): Hash {
  return new Hash(algorithm);
}

export function createHmac(algorithm: string, key: BufferLike): Hmac {
  return new Hmac(algorithm, key);
}

export function createCipheriv(
  algorithm: string,
  key: BufferLike,
  iv: BufferLike,
): Cipher {
  return new Cipher(algorithm, key, iv);
}

export function createDecipheriv(
  algorithm: string,
  key: BufferLike,
  iv: BufferLike,
): Decipher {
  return new Decipher(algorithm, key, iv);
}

export default {
  Hash,
  Hmac,
  Cipher,
  Decipher,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomFillSync,
  randomUUID,
  randomInt,
  timingSafeEqual,
  pbkdf2,
};
