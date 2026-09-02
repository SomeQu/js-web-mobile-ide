import { describe, expect, it } from "vitest";
import bufferModule, { Buffer } from "./buffer.js";

describe("Buffer.from", () => {
  it("encodes a utf-8 string and roundtrips via toString", () => {
    const buf = Buffer.from("hello");
    expect(buf.toString()).toBe("hello");
    expect(Array.from(buf)).toEqual([104, 101, 108, 108, 111]);
  });

  it("decodes base64", () => {
    expect(Buffer.from("aGVsbG8=", "base64").toString()).toBe("hello");
  });

  it("decodes hex", () => {
    expect(Buffer.from("68656c6c6f", "hex").toString()).toBe("hello");
  });

  it("builds from an array of byte values", () => {
    expect(Buffer.from([0x48, 0x69]).toString()).toBe("Hi");
  });

  it("builds from an ArrayBuffer", () => {
    expect(Buffer.from(new ArrayBuffer(4)).length).toBe(4);
  });
});

describe("Buffer.alloc", () => {
  it("zero-fills by default", () => {
    const buf = Buffer.alloc(10);
    expect(buf.length).toBe(10);
    expect(Array.from(buf)).toEqual(new Array(10).fill(0));
  });

  it("fills with a byte value", () => {
    expect(Buffer.alloc(5, 0x41).toString()).toBe("AAAAA");
  });
});

describe("Buffer.concat", () => {
  it("concatenates buffers", () => {
    expect(Buffer.concat([Buffer.from("a"), Buffer.from("b")]).toString()).toBe(
      "ab",
    );
  });
});

describe("Buffer.isBuffer", () => {
  it("true for Buffer instances", () => {
    expect(Buffer.isBuffer(Buffer.from("x"))).toBe(true);
  });

  it("false for plain Uint8Array", () => {
    expect(Buffer.isBuffer(new Uint8Array(1))).toBe(false);
  });
});

describe("Buffer.byteLength", () => {
  it("counts ascii bytes", () => {
    expect(Buffer.byteLength("hello")).toBe(5);
  });

  it("counts multi-byte utf-8 bytes", () => {
    expect(Buffer.byteLength("café")).toBe(5);
  });
});

describe("Buffer.isEncoding", () => {
  it("true for known encodings", () => {
    expect(Buffer.isEncoding("utf8")).toBe(true);
  });

  it("false for unknown encodings", () => {
    expect(Buffer.isEncoding("nope")).toBe(false);
  });
});

describe("slice", () => {
  it("returns a Buffer sharing the underlying memory", () => {
    const buf = Buffer.from("hello world");
    const sliced = buf.slice(0, 5);
    expect(sliced.toString()).toBe("hello");
    expect(Buffer.isBuffer(sliced)).toBe(true);

    buf._buf[0] = "H".charCodeAt(0);
    expect(sliced.toString()).toBe("Hello");
  });
});

describe("copy", () => {
  it("copies bytes between buffers", () => {
    const src = Buffer.from("hello");
    const dst = Buffer.alloc(5);
    const written = src.copy(dst);
    expect(written).toBe(5);
    expect(dst.toString()).toBe("hello");
  });
});

describe("equals / compare", () => {
  it("equals returns true for identical contents", () => {
    expect(Buffer.from("abc").equals(Buffer.from("abc"))).toBe(true);
    expect(Buffer.from("abc").equals(Buffer.from("abd"))).toBe(false);
  });

  it("compare orders lexicographically", () => {
    expect(Buffer.from("a").compare(Buffer.from("b"))).toBe(-1);
    expect(Buffer.from("b").compare(Buffer.from("a"))).toBe(1);
    expect(Buffer.from("a").compare(Buffer.from("a"))).toBe(0);
  });
});

describe("read/write integers", () => {
  it("readUInt8 / writeUInt8", () => {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(200, 0);
    expect(buf.readUInt8(0)).toBe(200);
  });

  it("readInt8 / writeInt8", () => {
    const buf = Buffer.alloc(1);
    buf.writeInt8(-100, 0);
    expect(buf.readInt8(0)).toBe(-100);
  });

  it("readUInt16LE / writeUInt16LE", () => {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(0x1234, 0);
    expect(buf.readUInt16LE(0)).toBe(0x1234);
  });

  it("readUInt16BE / writeUInt16BE", () => {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(0x1234, 0);
    expect(buf.readUInt16BE(0)).toBe(0x1234);
  });

  it("readInt16LE / readInt16BE", () => {
    const buf = Buffer.alloc(2);
    buf.writeInt16LE(-1234, 0);
    expect(buf.readInt16LE(0)).toBe(-1234);
    buf.writeInt16BE(-1234, 0);
    expect(buf.readInt16BE(0)).toBe(-1234);
  });

  it("readUInt32LE / writeUInt32LE", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(0x12345678, 0);
    expect(buf.readUInt32LE(0)).toBe(0x12345678);
  });

  it("readUInt32BE / writeUInt32BE", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(0x12345678, 0);
    expect(buf.readUInt32BE(0)).toBe(0x12345678);
  });

  it("readInt32LE / readInt32BE", () => {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(-123456, 0);
    expect(buf.readInt32LE(0)).toBe(-123456);
    buf.writeInt32BE(-123456, 0);
    expect(buf.readInt32BE(0)).toBe(-123456);
  });
});

describe("read/write floats", () => {
  it("readFloatLE roundtrips", () => {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(1.5, 0);
    expect(buf.readFloatLE(0)).toBeCloseTo(1.5);
  });

  it("readDoubleBE roundtrips", () => {
    const buf = Buffer.alloc(8);
    buf.writeDoubleBE(3.14159, 0);
    expect(buf.readDoubleBE(0)).toBeCloseTo(3.14159);
  });
});

describe("indexOf", () => {
  it("finds a byte value", () => {
    expect(Buffer.from("hello").indexOf(0x6c)).toBe(2);
  });

  it("finds a substring", () => {
    expect(Buffer.from("hello").indexOf("lo")).toBe(3);
  });

  it("returns -1 when not found", () => {
    expect(Buffer.from("hello").indexOf("z")).toBe(-1);
  });
});

describe("fill", () => {
  it("fills the buffer with a byte value", () => {
    const buf = Buffer.alloc(4);
    buf.fill(0x61);
    expect(buf.toString()).toBe("aaaa");
  });
});

describe("toJSON", () => {
  it("returns a Buffer-shaped object", () => {
    expect(Buffer.from("Hi").toJSON()).toEqual({
      type: "Buffer",
      data: [72, 105],
    });
  });
});

describe("iterator", () => {
  it("yields byte values", () => {
    expect([...Buffer.from("Hi")]).toEqual([72, 105]);
  });
});

describe("entries / keys / values", () => {
  it("entries yields [index, byte] pairs", () => {
    expect([...Buffer.from("Hi").entries()]).toEqual([
      [0, 72],
      [1, 105],
    ]);
  });

  it("keys yields indices", () => {
    expect([...Buffer.from("Hi").keys()]).toEqual([0, 1]);
  });

  it("values yields byte values", () => {
    expect([...Buffer.from("Hi").values()]).toEqual([72, 105]);
  });

  it("entries/keys/values are independently iterable", () => {
    const buf = Buffer.from("ab");
    const e1 = buf.entries();
    const e2 = buf.entries();
    expect(e1.next()).toEqual({ value: [0, 97], done: false });
    expect(e2.next()).toEqual({ value: [0, 97], done: false });
  });
});

describe("write", () => {
  it("writes a string and returns bytes written", () => {
    const buf = Buffer.alloc(5);
    const written = buf.write("hi", 0);
    expect(written).toBe(2);
    expect(buf.toString("utf-8", 0, 2)).toBe("hi");
  });

  it("respects offset, length, and encoding", () => {
    const buf = Buffer.alloc(10);
    const written = buf.write("hello", 2, 3, "utf-8");
    expect(written).toBe(3);
    expect(buf.toString("utf-8", 2, 5)).toBe("hel");
  });
});

describe("default export", () => {
  it("contains the Buffer class", () => {
    expect(bufferModule.Buffer).toBe(Buffer);
  });
});
