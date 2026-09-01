/// <reference types="node" />
import { describe, expect, it } from "vitest";
import stringDecoderModule, { StringDecoder } from "./string-decoder.js";
import { Buffer } from "./buffer.js";

describe("StringDecoder utf-8", () => {
  it("decodes a simple ascii-range write", () => {
    const decoder = new StringDecoder("utf-8");
    expect(decoder.write(Buffer.from("hello"))).toBe("hello");
  });

  it("handles a multi-byte character split across writes", () => {
    // "€" (U+20AC) encodes as 3 bytes: 0xE2 0x82 0xAC
    const full = new TextEncoder().encode("€");
    expect(full.length).toBe(3);

    const decoder = new StringDecoder("utf-8");
    const first = decoder.write(full.subarray(0, 2));
    expect(first).toBe("");
    const second = decoder.write(full.subarray(2, 3));
    expect(second).toBe("€");
  });

  it("flushes remaining bytes on end()", () => {
    const full = new TextEncoder().encode("€");
    const decoder = new StringDecoder("utf-8");
    decoder.write(full.subarray(0, 2));
    const flushed = decoder.end();
    expect(flushed.length).toBeGreaterThan(0);
  });

  it("decodes text spanning multiple complete writes", () => {
    const decoder = new StringDecoder("utf-8");
    let out = "";
    out += decoder.write(Buffer.from("hello "));
    out += decoder.write(Buffer.from("world"));
    out += decoder.end();
    expect(out).toBe("hello world");
  });
});

describe("StringDecoder ascii", () => {
  it("decodes ascii bytes", () => {
    const decoder = new StringDecoder("ascii");
    expect(decoder.write(Buffer.from("hello"))).toBe("hello");
  });
});

describe("StringDecoder latin1", () => {
  it("decodes latin1 bytes", () => {
    const decoder = new StringDecoder("latin1");
    expect(decoder.write(new Uint8Array([104, 105]))).toBe("hi");
  });
});

describe("string_decoder default export", () => {
  it("exposes StringDecoder", () => {
    expect(stringDecoderModule.StringDecoder).toBe(StringDecoder);
  });
});
