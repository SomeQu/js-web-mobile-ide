// Minimal Node-compatible Buffer shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained. Uses composition over a Uint8Array
// (rather than `class Buffer extends Uint8Array`) per Task 2 clarification —
// extending typed arrays has ES2020 compatibility quirks in some JSC builds.

// `TextEncoder`/`TextDecoder`/`btoa`/`atob` are provided by the
// JavaScriptCore/WKWebView host (and by Node, which is what vitest runs
// under), but the ES2020 lib (no DOM) doesn't declare them — add minimal
// ambient shapes local to this module.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array): string;
}
declare function btoa(data: string): string;
declare function atob(data: string): string;

export type BufferEncoding =
  "utf-8" | "utf8" | "ascii" | "latin1" | "binary" | "base64" | "hex";

const VALID_ENCODINGS: ReadonlySet<string> = new Set([
  "utf-8",
  "utf8",
  "ascii",
  "latin1",
  "binary",
  "base64",
  "hex",
]);

function normalizeEncoding(encoding?: string): BufferEncoding {
  const enc = (encoding ?? "utf-8").toLowerCase();
  if (!VALID_ENCODINGS.has(enc)) {
    throw new TypeError(`Unknown encoding: ${encoding}`);
  }
  return enc as BufferEncoding;
}

// Maps a Buffer encoding name to the label TextDecoder expects. Only utf-8
// has a TextDecoder-native path; the rest are handled manually below.
function encodingToLabel(encoding: BufferEncoding): string {
  switch (encoding) {
    case "utf8":
    case "utf-8":
      return "utf-8";
    default:
      return "utf-8";
  }
}

function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexDecode(str: string): Uint8Array {
  const clean = str.length % 2 === 0 ? str : str.slice(0, -1);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function asciiEncode(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0x7f;
  }
  return out;
}

function latin1Encode(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function encodeString(str: string, encoding?: string): Uint8Array {
  const enc = normalizeEncoding(encoding);
  switch (enc) {
    case "utf8":
    case "utf-8":
      return new TextEncoder().encode(str);
    case "ascii":
      return asciiEncode(str);
    case "latin1":
    case "binary":
      return latin1Encode(str);
    case "base64":
      return base64Decode(str);
    case "hex":
      return hexDecode(str);
  }
}

function decodeBytes(bytes: Uint8Array, encoding?: string): string {
  const enc = normalizeEncoding(encoding);
  switch (enc) {
    case "utf8":
    case "utf-8":
      return new TextDecoder(encodingToLabel(enc)).decode(bytes);
    case "ascii": {
      let s = "";
      for (let i = 0; i < bytes.length; i++) {
        s += String.fromCharCode(bytes[i] & 0x7f);
      }
      return s;
    }
    case "latin1":
    case "binary": {
      let s = "";
      for (let i = 0; i < bytes.length; i++) {
        s += String.fromCharCode(bytes[i]);
      }
      return s;
    }
    case "base64":
      return base64Encode(bytes);
    case "hex":
      return hexEncode(bytes);
  }
}

export type BufferLike = Buffer | Uint8Array;

export class Buffer {
  _isBuffer = true;
  _buf: Uint8Array;

  constructor(buf: Uint8Array) {
    this._buf = buf;
  }

  get length(): number {
    return this._buf.length;
  }

  get buffer(): ArrayBufferLike {
    return this._buf.buffer;
  }

  get byteOffset(): number {
    return this._buf.byteOffset;
  }

  static from(
    value: string | ArrayLike<number> | ArrayBufferLike | BufferLike,
    encodingOrOffset?: string | number,
    length?: number,
  ): Buffer {
    if (typeof value === "string") {
      return new Buffer(
        encodeString(value, encodingOrOffset as string | undefined),
      );
    }
    if (value instanceof Buffer) {
      return new Buffer(value._buf.slice());
    }
    if (value instanceof Uint8Array) {
      return new Buffer(Uint8Array.from(value));
    }
    if (value instanceof ArrayBuffer) {
      const offset = (encodingOrOffset as number) ?? 0;
      const len = length ?? value.byteLength - offset;
      return new Buffer(new Uint8Array(value, offset, len));
    }
    return new Buffer(Uint8Array.from(value as ArrayLike<number>));
  }

  static alloc(
    size: number,
    fill: number | string = 0,
    encoding?: string,
  ): Buffer {
    const buf = new Buffer(new Uint8Array(size));
    if (fill !== 0 && fill !== "") {
      buf.fill(fill, 0, size, encoding);
    }
    return buf;
  }

  static allocUnsafe(size: number): Buffer {
    return new Buffer(new Uint8Array(size));
  }

  static concat(list: BufferLike[], totalLength?: number): Buffer {
    const total = totalLength ?? list.reduce((sum, b) => sum + b.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const b of list) {
      if (offset >= total) {
        break;
      }
      const src = b instanceof Buffer ? b._buf : b;
      const slice = src.subarray(0, Math.min(src.length, total - offset));
      out.set(slice, offset);
      offset += slice.length;
    }
    return new Buffer(out);
  }

  static isBuffer(obj: unknown): obj is Buffer {
    return (
      !!obj &&
      typeof obj === "object" &&
      (obj as { _isBuffer?: boolean })._isBuffer === true
    );
  }

  static byteLength(value: string | BufferLike, encoding?: string): number {
    if (typeof value === "string") {
      return encodeString(value, encoding).length;
    }
    return value.length;
  }

  static isEncoding(encoding: string): boolean {
    return VALID_ENCODINGS.has((encoding ?? "").toLowerCase());
  }

  toString(
    encoding?: string,
    start = 0,
    end: number = this._buf.length,
  ): string {
    return decodeBytes(this._buf.subarray(start, end), encoding);
  }

  slice(start?: number, end?: number): Buffer {
    return new Buffer(this._buf.subarray(start, end));
  }

  subarray(start?: number, end?: number): Buffer {
    return this.slice(start, end);
  }

  copy(
    target: Buffer,
    targetStart = 0,
    sourceStart = 0,
    sourceEnd: number = this._buf.length,
  ): number {
    const src = this._buf.subarray(sourceStart, sourceEnd);
    target._buf.set(src, targetStart);
    return src.length;
  }

  equals(other: BufferLike): boolean {
    const otherBuf = other instanceof Buffer ? other._buf : other;
    if (this._buf.length !== otherBuf.length) {
      return false;
    }
    for (let i = 0; i < this._buf.length; i++) {
      if (this._buf[i] !== otherBuf[i]) {
        return false;
      }
    }
    return true;
  }

  compare(other: BufferLike): number {
    const otherBuf = other instanceof Buffer ? other._buf : other;
    const len = Math.min(this._buf.length, otherBuf.length);
    for (let i = 0; i < len; i++) {
      if (this._buf[i] !== otherBuf[i]) {
        return this._buf[i] < otherBuf[i] ? -1 : 1;
      }
    }
    if (this._buf.length === otherBuf.length) {
      return 0;
    }
    return this._buf.length < otherBuf.length ? -1 : 1;
  }

  fill(
    value: number | string,
    start = 0,
    end: number = this._buf.length,
    encoding?: string,
  ): this {
    let bytes: Uint8Array;
    if (typeof value === "number") {
      bytes = new Uint8Array([value & 0xff]);
    } else if (value.length === 0) {
      bytes = new Uint8Array([0]);
    } else {
      bytes = encodeString(value, encoding);
    }
    for (let i = start; i < end; i++) {
      this._buf[i] = bytes[(i - start) % bytes.length];
    }
    return this;
  }

  indexOf(value: number | string | BufferLike, byteOffset = 0): number {
    let needle: Uint8Array;
    if (typeof value === "number") {
      needle = new Uint8Array([value & 0xff]);
    } else if (typeof value === "string") {
      needle = encodeString(value);
    } else {
      needle = value instanceof Buffer ? value._buf : value;
    }
    if (needle.length === 0) {
      return byteOffset <= this._buf.length ? byteOffset : -1;
    }
    outer: for (
      let i = byteOffset;
      i <= this._buf.length - needle.length;
      i++
    ) {
      for (let j = 0; j < needle.length; j++) {
        if (this._buf[i + j] !== needle[j]) {
          continue outer;
        }
      }
      return i;
    }
    return -1;
  }

  includes(value: number | string | BufferLike): boolean {
    return this.indexOf(value) !== -1;
  }

  toJSON(): { type: "Buffer"; data: number[] } {
    return { type: "Buffer", data: Array.from(this._buf) };
  }

  write(
    str: string,
    offsetOrEncoding?: number | string,
    lengthOrEncoding?: number | string,
    encoding?: string,
  ): number {
    let offset = 0;
    let length = this._buf.length;
    let enc: string | undefined;

    if (typeof offsetOrEncoding === "string") {
      enc = offsetOrEncoding;
    } else if (typeof offsetOrEncoding === "number") {
      offset = offsetOrEncoding;
      length = this._buf.length - offset;
      if (typeof lengthOrEncoding === "string") {
        enc = lengthOrEncoding;
      } else if (typeof lengthOrEncoding === "number") {
        length = lengthOrEncoding;
        enc = encoding;
      }
    }

    const bytes = encodeString(str, enc);
    const maxLen = Math.min(length, this._buf.length - offset, bytes.length);
    for (let i = 0; i < maxLen; i++) {
      this._buf[offset + i] = bytes[i];
    }
    return maxLen;
  }

  private view(): DataView {
    return new DataView(
      this._buf.buffer,
      this._buf.byteOffset,
      this._buf.length,
    );
  }

  readUInt8(offset = 0): number {
    return this.view().getUint8(offset);
  }
  readInt8(offset = 0): number {
    return this.view().getInt8(offset);
  }
  readUInt16LE(offset = 0): number {
    return this.view().getUint16(offset, true);
  }
  readUInt16BE(offset = 0): number {
    return this.view().getUint16(offset, false);
  }
  readInt16LE(offset = 0): number {
    return this.view().getInt16(offset, true);
  }
  readInt16BE(offset = 0): number {
    return this.view().getInt16(offset, false);
  }
  readUInt32LE(offset = 0): number {
    return this.view().getUint32(offset, true);
  }
  readUInt32BE(offset = 0): number {
    return this.view().getUint32(offset, false);
  }
  readInt32LE(offset = 0): number {
    return this.view().getInt32(offset, true);
  }
  readInt32BE(offset = 0): number {
    return this.view().getInt32(offset, false);
  }
  readFloatLE(offset = 0): number {
    return this.view().getFloat32(offset, true);
  }
  readFloatBE(offset = 0): number {
    return this.view().getFloat32(offset, false);
  }
  readDoubleLE(offset = 0): number {
    return this.view().getFloat64(offset, true);
  }
  readDoubleBE(offset = 0): number {
    return this.view().getFloat64(offset, false);
  }

  writeUInt8(value: number, offset = 0): number {
    this.view().setUint8(offset, value);
    return offset + 1;
  }
  writeInt8(value: number, offset = 0): number {
    this.view().setInt8(offset, value);
    return offset + 1;
  }
  writeUInt16LE(value: number, offset = 0): number {
    this.view().setUint16(offset, value, true);
    return offset + 2;
  }
  writeUInt16BE(value: number, offset = 0): number {
    this.view().setUint16(offset, value, false);
    return offset + 2;
  }
  writeInt16LE(value: number, offset = 0): number {
    this.view().setInt16(offset, value, true);
    return offset + 2;
  }
  writeInt16BE(value: number, offset = 0): number {
    this.view().setInt16(offset, value, false);
    return offset + 2;
  }
  writeUInt32LE(value: number, offset = 0): number {
    this.view().setUint32(offset, value, true);
    return offset + 4;
  }
  writeUInt32BE(value: number, offset = 0): number {
    this.view().setUint32(offset, value, false);
    return offset + 4;
  }
  writeInt32LE(value: number, offset = 0): number {
    this.view().setInt32(offset, value, true);
    return offset + 4;
  }
  writeInt32BE(value: number, offset = 0): number {
    this.view().setInt32(offset, value, false);
    return offset + 4;
  }
  writeFloatLE(value: number, offset = 0): number {
    this.view().setFloat32(offset, value, true);
    return offset + 4;
  }
  writeFloatBE(value: number, offset = 0): number {
    this.view().setFloat32(offset, value, false);
    return offset + 4;
  }
  writeDoubleLE(value: number, offset = 0): number {
    this.view().setFloat64(offset, value, true);
    return offset + 8;
  }
  writeDoubleBE(value: number, offset = 0): number {
    this.view().setFloat64(offset, value, false);
    return offset + 8;
  }

  [Symbol.iterator](): IterableIterator<number> {
    return this._buf[Symbol.iterator]();
  }

  entries(): IterableIterator<[number, number]> {
    const buf = this._buf;
    let index = 0;
    const iterator: IterableIterator<[number, number]> = {
      next(): IteratorResult<[number, number]> {
        if (index < buf.length) {
          const result = { value: [index, buf[index]] as [number, number], done: false };
          index++;
          return result;
        }
        return { value: undefined as unknown as [number, number], done: true };
      },
      [Symbol.iterator](): IterableIterator<[number, number]> {
        return iterator;
      },
    };
    return iterator;
  }

  keys(): IterableIterator<number> {
    const buf = this._buf;
    let index = 0;
    const iterator: IterableIterator<number> = {
      next(): IteratorResult<number> {
        if (index < buf.length) {
          return { value: index++, done: false };
        }
        return { value: undefined as unknown as number, done: true };
      },
      [Symbol.iterator](): IterableIterator<number> {
        return iterator;
      },
    };
    return iterator;
  }

  values(): IterableIterator<number> {
    return this._buf[Symbol.iterator]();
  }
}

interface BufferModule {
  Buffer: typeof Buffer;
}

const bufferModule: BufferModule = { Buffer };

export default bufferModule;
