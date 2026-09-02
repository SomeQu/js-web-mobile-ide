// Minimal Node-compatible `string_decoder` shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained.

// `TextDecoder` is provided by the JavaScriptCore/WKWebView host (and by
// Node, which is what vitest runs under), but the ES2020 lib (no DOM)
// doesn't declare it — add a minimal ambient shape local to this module.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}
declare function btoa(data: string): string;

export type StringDecoderEncoding =
  | "utf8"
  | "utf-8"
  | "ascii"
  | "latin1"
  | "binary"
  | "base64"
  | "hex";

function normalizeEncoding(encoding?: string): StringDecoderEncoding {
  const enc = (encoding ?? "utf8").toLowerCase() as StringDecoderEncoding;
  return enc;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) {
    return b;
  }
  if (b.length === 0) {
    return a;
  }
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// Returns how many trailing bytes of `buf` belong to an incomplete UTF-8
// multi-byte sequence (0 if the buffer ends on a complete sequence).
function incompleteUtf8TailLength(buf: Uint8Array): number {
  const len = buf.length;
  const scanLimit = Math.min(4, len);
  for (let i = 1; i <= scanLimit; i++) {
    const byte = buf[len - i];
    if ((byte & 0xc0) === 0x80) {
      // continuation byte — keep scanning backwards for the leading byte
      continue;
    }
    let seqLen: number;
    if ((byte & 0x80) === 0x00) {
      seqLen = 1;
    } else if ((byte & 0xe0) === 0xc0) {
      seqLen = 2;
    } else if ((byte & 0xf0) === 0xe0) {
      seqLen = 3;
    } else if ((byte & 0xf8) === 0xf0) {
      seqLen = 4;
    } else {
      // Invalid leading byte — don't hold anything back, let the decoder
      // deal with it (it will emit a replacement character).
      return 0;
    }
    return seqLen > i ? i : 0;
  }
  // More than 4 trailing continuation bytes — not a valid sequence tail,
  // don't buffer forever.
  return 0;
}

function asciiDecode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i] & 0x7f);
  }
  return s;
}

function latin1Decode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

function hexDecode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function base64Decode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Deliberately loose: this only needs to describe "something with bytes in
// it" well enough to accept both `Uint8Array` and the `Buffer` shim from
// `./buffer.ts` (which is composition-based and has no index signature of
// its own — see the comment on `Buffer` there) without a cross-shim import.
export interface BufferLike {
  readonly length: number;
  [Symbol.iterator]?: () => Iterator<number>;
}

function toUint8Array(input: BufferLike | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }

  // Buffer (from ./buffer.ts) wraps its bytes in a `_buf` field rather than
  // exposing numeric indices directly — prefer that when present.
  const maybeBuf = (input as { _buf?: unknown })._buf;
  if (maybeBuf instanceof Uint8Array) {
    return maybeBuf;
  }

  if (typeof input[Symbol.iterator] === "function") {
    return Uint8Array.from(input as Iterable<number>);
  }

  throw new TypeError("StringDecoder: unsupported input type");
}

export class StringDecoder {
  encoding: StringDecoderEncoding;
  private leftover: Uint8Array = new Uint8Array(0);
  private decoder: TextDecoder | null;

  constructor(encoding?: string) {
    this.encoding = normalizeEncoding(encoding);
    this.decoder =
      this.encoding === "utf8" || this.encoding === "utf-8"
        ? new TextDecoder("utf-8")
        : null;
  }

  write(buf: BufferLike | Uint8Array): string {
    const bytes = toUint8Array(buf);

    if (!this.decoder) {
      // Single-byte encodings never split a character across writes.
      switch (this.encoding) {
        case "ascii":
          return asciiDecode(bytes);
        case "latin1":
        case "binary":
          return latin1Decode(bytes);
        case "base64":
          return base64Decode(bytes);
        case "hex":
          return hexDecode(bytes);
        default:
          return latin1Decode(bytes);
      }
    }

    const combined = concatBytes(this.leftover, bytes);
    const incomplete = incompleteUtf8TailLength(combined);
    const completeLen = combined.length - incomplete;
    const decoded = this.decoder.decode(combined.subarray(0, completeLen));
    this.leftover =
      incomplete > 0 ? combined.slice(completeLen) : new Uint8Array(0);
    return decoded;
  }

  end(buf?: BufferLike | Uint8Array): string {
    let tail = "";
    if (buf !== undefined) {
      tail = this.write(buf);
    }

    if (!this.decoder) {
      this.leftover = new Uint8Array(0);
      return tail;
    }

    if (this.leftover.length > 0) {
      // Flush whatever is left, even if incomplete — the (non-fatal)
      // TextDecoder emits a replacement character for the dangling bytes.
      tail += this.decoder.decode(this.leftover);
      this.leftover = new Uint8Array(0);
    }
    return tail;
  }

  text(buf: BufferLike | Uint8Array): string {
    return this.write(buf);
  }
}

interface StringDecoderModule {
  StringDecoder: typeof StringDecoder;
}

const stringDecoderModule: StringDecoderModule = { StringDecoder };

export default stringDecoderModule;
