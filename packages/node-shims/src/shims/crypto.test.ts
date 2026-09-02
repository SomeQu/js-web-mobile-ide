/// <reference types="node" />
import { describe, expect, it } from "vitest";
import {
  randomBytes, randomFillSync, randomUUID, randomInt, timingSafeEqual,
  createHash, createHmac, createCipheriv, createDecipheriv, pbkdf2,
} from "./crypto.js";
import { Buffer } from "./buffer.js";

describe("randomBytes", () => {
  it("returns Buffer of requested size", () => {
    const buf = randomBytes(32);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(32);
  });

  it("returns different values on each call", () => {
    const a = randomBytes(16);
    const b = randomBytes(16);
    expect(a.equals(b)).toBe(false);
  });
});

describe("randomFillSync", () => {
  it("fills a Buffer with random bytes", () => {
    const buf = Buffer.alloc(16);
    const result = randomFillSync(buf);
    expect(result).toBe(buf);
    // Check that at least some bytes are non-zero
    let hasNonZero = false;
    for (const b of buf) {
      if (b !== 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
  });

  it("fills a Uint8Array", () => {
    const arr = new Uint8Array(16);
    const result = randomFillSync(arr);
    expect(result).toBe(arr);
  });

  it("respects offset and size", () => {
    const buf = Buffer.alloc(16);
    randomFillSync(buf, 4, 8);
    // First 4 bytes should still be zero
    expect(buf.readUInt32LE(0)).toBe(0);
  });
});

describe("randomUUID", () => {
  it("returns a v4 UUID string", () => {
    const uuid = randomUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe("randomInt", () => {
  it("returns integer in range [0, max)", () => {
    for (let i = 0; i < 20; i++) {
      const val = randomInt(10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(10);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it("returns integer in range [min, max)", () => {
    for (let i = 0; i < 20; i++) {
      const val = randomInt(5, 15);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThan(15);
    }
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal buffers", () => {
    const a = Buffer.from("hello");
    const b = Buffer.from("hello");
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("returns false for different buffers", () => {
    const a = Buffer.from("hello");
    const b = Buffer.from("world");
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("throws for different lengths", () => {
    const a = Buffer.from("hi");
    const b = Buffer.from("hello");
    expect(() => timingSafeEqual(a, b)).toThrow();
  });

  it("works with Uint8Array", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(timingSafeEqual(a, b)).toBe(true);
  });
});

describe("createHash", () => {
  it("computes SHA-256 of a string", async () => {
    const hash = createHash("sha256");
    hash.update("hello");
    const hex = await hash.digest("hex");
    expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("computes SHA-256 with multiple updates", async () => {
    const hash = createHash("sha256");
    hash.update("hel");
    hash.update("lo");
    const hex = await hash.digest("hex");
    expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("computes SHA-512", async () => {
    const hash = createHash("sha512");
    hash.update("hello");
    const hex = await hash.digest("hex");
    expect(hex).toHaveLength(128); // SHA-512 = 64 bytes = 128 hex chars
  });

  it("computes SHA-1", async () => {
    const hash = createHash("sha1");
    hash.update("hello");
    const hex = await hash.digest("hex");
    expect(hex).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
  });

  it("digest returns Buffer by default", async () => {
    const hash = createHash("sha256");
    hash.update("hello");
    const buf = await hash.digest();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(32);
  });

  it("digest base64", async () => {
    const hash = createHash("sha256");
    hash.update("hello");
    const b64 = await hash.digest("base64");
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);
  });

  it("accepts Buffer input", async () => {
    const hash = createHash("sha256");
    hash.update(Buffer.from("hello"));
    const hex = await hash.digest("hex");
    expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("throws on unsupported algorithm", () => {
    expect(() => createHash("md5")).toThrow("not supported");
  });

  it("update returns this for chaining", () => {
    const hash = createHash("sha256");
    const result = hash.update("hello");
    expect(result).toBe(hash);
  });

  it("accepts hyphenated algorithm name (sha-256)", async () => {
    const hash = createHash("sha-256");
    hash.update("hello");
    const hex = await hash.digest("hex");
    expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});

describe("createHmac", () => {
  it("computes HMAC-SHA256", async () => {
    const hmac = createHmac("sha256", "secret");
    hmac.update("hello");
    const hex = await hmac.digest("hex");
    expect(typeof hex).toBe("string");
    expect(hex.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
  });

  it("known HMAC-SHA256 vector", async () => {
    const hmac = createHmac("sha256", "key");
    hmac.update("The quick brown fox jumps over the lazy dog");
    const hex = await hmac.digest("hex");
    expect(hex).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it("accepts Buffer key", async () => {
    const hmac = createHmac("sha256", Buffer.from("key"));
    hmac.update("data");
    const hex = await hmac.digest("hex");
    expect(typeof hex).toBe("string");
  });
});

describe("createCipheriv / createDecipheriv", () => {
  it("AES-256-CBC roundtrip", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const plaintext = "hello world, this is a test";

    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const enc1 = await cipher.update(plaintext);
    const enc2 = await cipher.final();
    const encrypted = Buffer.concat([enc1, enc2]);

    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    const dec1 = await decipher.update(encrypted);
    const dec2 = await decipher.final();
    const decrypted = Buffer.concat([dec1, dec2]);

    expect(decrypted.toString("utf-8")).toBe(plaintext);
  });

  it("AES-256-GCM roundtrip with authTag", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const plaintext = "secret message";

    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc1 = await cipher.update(plaintext);
    const enc2 = await cipher.final();
    const encrypted = Buffer.concat([enc1, enc2]);
    const authTag = cipher.getAuthTag();

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const dec1 = await decipher.update(encrypted);
    const dec2 = await decipher.final();
    const decrypted = Buffer.concat([dec1, dec2]);

    expect(decrypted.toString("utf-8")).toBe(plaintext);
  });

  it("AES-256-CTR roundtrip", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const plaintext = "ctr mode test";

    const cipher = createCipheriv("aes-256-ctr", key, iv);
    const enc1 = await cipher.update(plaintext);
    const enc2 = await cipher.final();
    const encrypted = Buffer.concat([enc1, enc2]);

    const decipher = createDecipheriv("aes-256-ctr", key, iv);
    const dec1 = await decipher.update(encrypted);
    const dec2 = await decipher.final();
    const decrypted = Buffer.concat([dec1, dec2]);

    expect(decrypted.toString("utf-8")).toBe(plaintext);
  });

  it("throws on unsupported cipher algorithm", () => {
    expect(() => createCipheriv("des-cbc", randomBytes(8), randomBytes(8))).toThrow();
  });
});

describe("pbkdf2", () => {
  it("derives key with known vector", () => {
    return new Promise<void>((resolve, reject) => {
      pbkdf2("password", "salt", 1, 32, "sha256", (err, key) => {
        if (err) return reject(err);
        expect(Buffer.isBuffer(key)).toBe(true);
        expect(key.length).toBe(32);
        const hex = key.toString("hex");
        expect(hex).toBe("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
        resolve();
      });
    });
  });

  it("accepts Buffer password and salt", () => {
    return new Promise<void>((resolve, reject) => {
      pbkdf2(Buffer.from("password"), Buffer.from("salt"), 1, 20, "sha256", (err, key) => {
        if (err) return reject(err);
        expect(key.length).toBe(20);
        resolve();
      });
    });
  });
});
