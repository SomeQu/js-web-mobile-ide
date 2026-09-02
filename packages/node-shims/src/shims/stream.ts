// Minimal Node-compatible `stream` shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained except for the one intentional
// cross-shim import of `EventEmitter` from `./events.js`.
//
// This is a pure-JS, best-effort reimplementation of the parts of Node's
// stream module that matter for typical userland code: Readable/Writable
// with backpressure, Duplex/Transform/PassThrough, and `pipe`/`pipeline`.
// It favors readable, predictable behavior over byte-for-byte parity with
// Node's internal state machine.

import { EventEmitter } from "./events.js";

// `queueMicrotask` and `TextDecoder` are provided by the JavaScriptCore/
// WKWebView host (and by Node, which is what vitest runs under), but the
// ES2020 lib (no DOM/WebWorker) doesn't declare them — add minimal ambient
// shapes local to this module.
declare function queueMicrotask(callback: () => void): void;
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
type ErrCallback = (error?: Error | null) => void;

// Maps common Node encoding names to the labels TextDecoder understands.
// Other values are passed through as-is (TextDecoder supports a broader set
// of labels than Node's encoding names, e.g. "utf-16le").
function resolveTextDecoderEncoding(encoding: string): string {
  const lower = encoding.toLowerCase();
  if (lower === "utf8" || lower === "utf-8") {
    return "utf-8";
  }
  if (lower === "ascii" || lower === "latin1") {
    return "iso-8859-1";
  }
  return encoding;
}

function chunkLength(chunk: unknown, objectMode: boolean): number {
  if (objectMode) {
    return 1;
  }
  if (typeof chunk === "string") {
    return chunk.length;
  }
  if (chunk instanceof Uint8Array) {
    return chunk.length;
  }
  return String(chunk).length;
}

// A minimal structural type for "something pipe() can write to" — avoids a
// hard dependency between Stream and Writable at the type level (Duplex and
// Transform satisfy it too, since they mix in Writable's methods).
export interface WritableLike {
  write(chunk: unknown, encoding?: string): boolean;
  end(callback?: ErrCallback): unknown;
  on(event: string | symbol, listener: AnyFn): unknown;
  off(event: string | symbol, listener: AnyFn): unknown;
  emit(event: string | symbol, ...args: unknown[]): boolean;
}

/**
 * Base class every stream extends. Real behavior (`pipe` with backpressure)
 * lives on `Readable`; this class exists so `instanceof Stream` works for
 * all stream kinds, matching Node's class hierarchy.
 */
export class Stream extends EventEmitter {
  pipe<T extends WritableLike>(destination: T): T {
    return destination;
  }
}

export interface ReadableOptions {
  highWaterMark?: number;
  objectMode?: boolean;
  encoding?: string;
  autoDestroy?: boolean;
  read?: (this: Readable, size: number) => void;
  destroy?: (error: Error | null, callback: ErrCallback) => void;
}

interface ReadableState {
  buffer: unknown[];
  length: number;
  flowing: boolean | null;
  ended: boolean;
  endEmitted: boolean;
  encoding?: string;
  decoder?: TextDecoder;
  readableEmitScheduled: boolean;
  pipes: Array<{ dest: WritableLike }>;
}

interface PipeCleanup {
  onData: (chunk: unknown) => void;
  onDrain: () => void;
  onEnd: () => void;
}

export class Readable extends Stream {
  readableHighWaterMark: number;
  readableObjectMode: boolean;
  destroyed = false;

  private _rstate: ReadableState;
  private _reading = false;
  private _flowingActive = false;

  constructor(options: ReadableOptions = {}) {
    super();
    this.readableObjectMode = !!options.objectMode;
    this.readableHighWaterMark =
      options.highWaterMark ?? (this.readableObjectMode ? 16 : 16384);
    this._rstate = {
      buffer: [],
      length: 0,
      flowing: null,
      ended: false,
      endEmitted: false,
      readableEmitScheduled: false,
      pipes: [],
    };

    if (options.read) {
      this._read = options.read.bind(this);
    }
    if (options.destroy) {
      this._destroy = options.destroy.bind(this);
    }
    if (options.encoding) {
      this.setEncoding(options.encoding);
    }

    // Attaching a `data` listener puts the stream in flowing mode, matching
    // Node's `Readable`. We hook `newListener` rather than overriding `on`
    // so subclasses (Duplex/Transform) get this for free.
    this.on("newListener", (event: string) => {
      if (event === "data") {
        this.resume();
      }
    });

    // Kick off an initial read shortly after construction so a `readable`
    // listener (or a synchronous `.read()` call) attached in the same tick
    // sees data. Deferred to a microtask so listeners registered
    // synchronously right after construction are in place first.
    queueMicrotask(() => this._maybeRead());
  }

  // Default no-op; overridden via constructor `options.read` or by
  // subclasses (e.g. Transform, which drives its readable side via push()
  // from `_write` instead of pulling in `_read`).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _read(_size: number): void {}

  _destroy(error: Error | null, callback: ErrCallback): void {
    callback(error);
  }

  // Hook for Duplex: called after the readable side has fully ended
  // (`end` emitted). Default no-op; Duplex uses it for `allowHalfOpen`.
  protected _onReadableEnd(): void {}

  push(chunk: unknown, encoding?: string): boolean {
    return this._pushChunk(chunk, encoding, false);
  }

  unshift(chunk: unknown, encoding?: string): boolean {
    return this._pushChunk(chunk, encoding, true);
  }

  private _pushChunk(chunk: unknown, encoding: string | undefined, front: boolean): boolean {
    if (this.destroyed) {
      return false;
    }
    if (chunk === null) {
      this._rstate.ended = true;
      this._scheduleReadableEmit();
      this._maybeEmitEnd();
      return false;
    }

    // If `setEncoding` was called, decode binary chunks to strings as they
    // arrive (a chunk that's already a string is left as-is).
    let value = chunk;
    if (this._rstate.encoding && value instanceof Uint8Array) {
      value = this._rstate.decoder!.decode(value);
    }

    if (front) {
      this._rstate.buffer.unshift(value);
    } else {
      this._rstate.buffer.push(value);
    }
    this._rstate.length += chunkLength(value, this.readableObjectMode);

    this._scheduleReadableEmit();
    if (this._rstate.flowing === true && !this._flowingActive) {
      this._flow();
    }

    return this._rstate.length < this.readableHighWaterMark;
  }

  private _scheduleReadableEmit(): void {
    if (this._rstate.readableEmitScheduled) {
      return;
    }
    this._rstate.readableEmitScheduled = true;
    queueMicrotask(() => {
      this._rstate.readableEmitScheduled = false;
      if (this._rstate.buffer.length > 0 || this._rstate.ended) {
        this.emit("readable");
      }
    });
  }

  private _maybeRead(sizeHint?: number): void {
    if (this._reading || this._rstate.ended || this.destroyed) {
      return;
    }
    this._reading = true;
    this._read(sizeHint ?? this.readableHighWaterMark);
    this._reading = false;
  }

  private _flow(): void {
    if (this._flowingActive) {
      return;
    }
    this._flowingActive = true;
    try {
      while (this._rstate.flowing === true && !this.destroyed) {
        if (this._rstate.buffer.length > 0) {
          const chunk = this._rstate.buffer.shift();
          this._rstate.length -= chunkLength(chunk, this.readableObjectMode);
          this.emit("data", chunk);
          continue;
        }
        if (this._rstate.ended) {
          break;
        }
        if (this._reading) {
          break;
        }
        this._maybeRead();
        if (this._rstate.buffer.length === 0) {
          break;
        }
      }
    } finally {
      this._flowingActive = false;
    }
    this._maybeEmitEnd();
  }

  private _maybeEmitEnd(): void {
    if (
      this._rstate.ended &&
      !this._rstate.endEmitted &&
      this._rstate.buffer.length === 0
    ) {
      this._rstate.endEmitted = true;
      queueMicrotask(() => {
        this.emit("end");
        this._onReadableEnd();
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read(size?: number): any {
    if (this.destroyed) {
      return null;
    }
    if (this._rstate.buffer.length === 0) {
      this._maybeRead(size);
    }
    if (this._rstate.buffer.length === 0) {
      this._maybeEmitEnd();
      return null;
    }

    let result: unknown;
    if (this.readableObjectMode) {
      result = this._rstate.buffer.shift();
      this._rstate.length -= 1;
    } else if (size === undefined || size === null) {
      result = this._concatAll();
    } else {
      result = this._concatAndTake(size);
    }

    this._maybeEmitEnd();
    return result ?? null;
  }

  private _concatAll(): unknown {
    const chunks = this._rstate.buffer;
    this._rstate.buffer = [];
    this._rstate.length = 0;
    if (chunks.every((c) => typeof c === "string")) {
      return (chunks as string[]).join("");
    }
    return chunks.length === 1 ? chunks[0] : chunks;
  }

  private _concatAndTake(size: number): unknown {
    // Best-effort: only string buffers support partial slicing; everything
    // else falls back to returning the first buffered chunk.
    const first = this._rstate.buffer[0];
    if (typeof first !== "string") {
      this._rstate.buffer.shift();
      this._rstate.length -= chunkLength(first, false);
      return first;
    }
    const joined = (this._rstate.buffer as string[]).join("");
    const taken = joined.slice(0, size);
    const rest = joined.slice(taken.length);
    this._rstate.buffer = rest ? [rest] : [];
    this._rstate.length = rest.length;
    return taken;
  }

  pause(): this {
    this._rstate.flowing = false;
    return this;
  }

  resume(): this {
    if (this._rstate.flowing !== true) {
      this._rstate.flowing = true;
      queueMicrotask(() => {
        if (this._rstate.flowing === true) {
          this._maybeRead();
          this._flow();
        }
      });
    }
    return this;
  }

  isPaused(): boolean {
    return this._rstate.flowing === false;
  }

  setEncoding(encoding: string): this {
    this._rstate.encoding = encoding;
    this._rstate.decoder = new TextDecoder(resolveTextDecoderEncoding(encoding));
    return this;
  }

  destroy(error?: Error | null): this {
    if (this.destroyed) {
      return this;
    }
    this.destroyed = true;
    this._destroy(error ?? null, (err) => {
      if (err) {
        this.emit("error", err);
      }
      this.emit("close");
    });
    return this;
  }

  pipe<T extends WritableLike>(destination: T, options?: { end?: boolean }): T {
    const shouldEnd = options?.end !== false;

    const onData = (chunk: unknown): void => {
      const ok = destination.write(chunk);
      if (ok === false) {
        this.pause();
      }
    };
    const onDrain = (): void => {
      this.resume();
    };
    const onEnd = (): void => {
      if (shouldEnd) {
        destination.end();
      }
    };

    this._rstate.pipes.push({ dest: destination });
    (destination as unknown as { _pipeSource?: PipeCleanup })._pipeSource = {
      onData,
      onDrain,
      onEnd,
    };

    this.on("data", onData);
    destination.on("drain", onDrain);
    this.on("end", onEnd);

    destination.emit("pipe", this);
    this.resume();

    return destination;
  }

  unpipe(destination?: WritableLike): this {
    const targets = destination
      ? this._rstate.pipes.filter((p) => p.dest === destination)
      : this._rstate.pipes.slice();

    for (const { dest } of targets) {
      const meta = (dest as unknown as { _pipeSource?: PipeCleanup })._pipeSource;
      if (meta) {
        this.off("data", meta.onData);
        dest.off("drain", meta.onDrain);
        this.off("end", meta.onEnd);
      }
      dest.emit("unpipe", this);
    }

    this._rstate.pipes = destination
      ? this._rstate.pipes.filter((p) => p.dest !== destination)
      : [];

    return this;
  }

  get readable(): boolean {
    return !this.destroyed;
  }

  get readableLength(): number {
    return this._rstate.length;
  }

  get readableFlowing(): boolean | null {
    return this._rstate.flowing;
  }

  get readableEncoded(): boolean {
    return this._rstate.encoding !== undefined;
  }
}

export interface WritableOptions {
  highWaterMark?: number;
  objectMode?: boolean;
  decodeStrings?: boolean;
  defaultEncoding?: string;
  autoDestroy?: boolean;
  write?: (
    this: Writable,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunk: any,
    encoding: string | undefined,
    callback: ErrCallback,
  ) => void;
  final?: (this: Writable, callback: ErrCallback) => void;
  destroy?: (error: Error | null, callback: ErrCallback) => void;
}

interface WriteRequest {
  chunk: unknown;
  encoding?: string;
  len: number;
  callback: ErrCallback;
}

interface WritableState {
  length: number;
  corked: number;
  writing: boolean;
  ending: boolean;
  finished: boolean;
  finishStarted: boolean;
  needDrain: boolean;
  defaultEncoding: string;
  buffered: WriteRequest[];
}

export class Writable extends Stream {
  writableHighWaterMark: number;
  writableObjectMode: boolean;
  destroyed = false;

  private _wstate: WritableState;

  constructor(options: WritableOptions = {}) {
    super();
    this.writableObjectMode = !!options.objectMode;
    this.writableHighWaterMark =
      options.highWaterMark ?? (this.writableObjectMode ? 16 : 16384);
    this._wstate = {
      length: 0,
      corked: 0,
      writing: false,
      ending: false,
      finished: false,
      finishStarted: false,
      needDrain: false,
      defaultEncoding: options.defaultEncoding ?? "utf8",
      buffered: [],
    };

    if (options.write) {
      this._write = options.write.bind(this);
    }
    if (options.final) {
      this._final = options.final.bind(this);
    }
    if (options.destroy) {
      this._destroy = options.destroy.bind(this);
    }
  }

  _write(chunk: unknown, encoding: string | undefined, callback: ErrCallback): void {
    callback(new Error("_write() is not implemented"));
  }

  _final(callback: ErrCallback): void {
    callback();
  }

  _destroy(error: Error | null, callback: ErrCallback): void {
    callback(error);
  }

  write(chunk: unknown, encoding?: string | ErrCallback, callback?: ErrCallback): boolean {
    let enc: string | undefined;
    let cb: ErrCallback | undefined;
    if (typeof encoding === "function") {
      cb = encoding;
    } else {
      enc = encoding;
      cb = callback;
    }
    return this._enqueue(chunk, enc, cb ?? (() => {}));
  }

  private _enqueue(chunk: unknown, encoding: string | undefined, callback: ErrCallback): boolean {
    const len = chunkLength(chunk, this.writableObjectMode);
    this._wstate.length += len;
    this._wstate.buffered.push({ chunk, encoding, len, callback });
    this._pump();

    const ok = this._wstate.length <= this.writableHighWaterMark;
    if (!ok) {
      this._wstate.needDrain = true;
    }
    return ok;
  }

  private _pump(): void {
    if (this._wstate.corked > 0 || this._wstate.writing || this.destroyed) {
      return;
    }
    const next = this._wstate.buffered.shift();
    if (!next) {
      this._maybeFinish();
      return;
    }

    this._wstate.writing = true;
    this._write(next.chunk, next.encoding ?? this._wstate.defaultEncoding, (err) => {
      this._wstate.writing = false;
      this._wstate.length -= next.len;

      if (this._wstate.needDrain && this._wstate.length <= this.writableHighWaterMark) {
        this._wstate.needDrain = false;
        this.emit("drain");
      }

      if (err) {
        next.callback(err);
        this.destroy(err);
        return;
      }
      next.callback();
      this._pump();
    });
  }

  private _maybeFinish(): void {
    if (
      !this._wstate.ending ||
      this._wstate.finished ||
      this._wstate.finishStarted ||
      this._wstate.writing ||
      this._wstate.buffered.length > 0
    ) {
      return;
    }
    this._wstate.finishStarted = true;
    queueMicrotask(() => {
      this._final((err) => {
        if (err) {
          this.emit("error", err);
        }
        this._wstate.finished = true;
        this.emit("finish");
        this.emit("close");
      });
    });
  }

  end(chunk?: unknown | ErrCallback, encoding?: string | ErrCallback, callback?: ErrCallback): this {
    let data: unknown = chunk;
    let enc: string | undefined;
    let cb: ErrCallback | undefined = callback;

    if (typeof chunk === "function") {
      cb = chunk as ErrCallback;
      data = undefined;
    } else if (typeof encoding === "function") {
      cb = encoding as ErrCallback;
    } else {
      enc = encoding as string | undefined;
    }

    if (cb) {
      this.once("finish", cb);
    }
    if (data !== undefined) {
      this.write(data, enc);
    }
    this._wstate.ending = true;
    this._pump();
    return this;
  }

  cork(): void {
    this._wstate.corked++;
  }

  uncork(): void {
    if (this._wstate.corked > 0) {
      this._wstate.corked--;
    }
    if (this._wstate.corked === 0) {
      this._pump();
    }
  }

  setDefaultEncoding(encoding: string): this {
    this._wstate.defaultEncoding = encoding;
    return this;
  }

  destroy(error?: Error | null): this {
    if (this.destroyed) {
      return this;
    }
    this.destroyed = true;
    this._destroy(error ?? null, (err) => {
      if (err) {
        this.emit("error", err);
      }
      this.emit("close");
    });
    return this;
  }

  get writable(): boolean {
    return !this.destroyed && !this._wstate.ending;
  }

  get writableLength(): number {
    return this._wstate.length;
  }

  get writableCorked(): number {
    return this._wstate.corked;
  }

  get writableFinished(): boolean {
    return this._wstate.finished;
  }
}

export interface DuplexOptions extends ReadableOptions, Omit<WritableOptions, "write" | "final"> {
  allowHalfOpen?: boolean;
  write?: (
    this: Duplex,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunk: any,
    encoding: string | undefined,
    callback: ErrCallback,
  ) => void;
  final?: (this: Duplex, callback: ErrCallback) => void;
}

// Copied onto Duplex.prototype below so Duplex gets Writable's behavior
// without multiple inheritance. Every one of these methods only touches
// `this._wstate`/`this.writableHighWaterMark`/etc, which Duplex's
// constructor initializes the same way Writable's does.
const WRITABLE_MIXIN_METHODS = [
  "write",
  "end",
  "cork",
  "uncork",
  "setDefaultEncoding",
  "_write",
  "_final",
  "_enqueue",
  "_pump",
  "_maybeFinish",
] as const;

export class Duplex extends Readable {
  writableHighWaterMark!: number;
  writableObjectMode!: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _wstate!: any;
  private _allowHalfOpen: boolean;

  // Present so TypeScript knows these exist (assigned via prototype copy
  // below); actual implementations come from Writable.prototype.
  declare write: Writable["write"];
  declare end: Writable["end"];
  declare cork: Writable["cork"];
  declare uncork: Writable["uncork"];
  declare setDefaultEncoding: Writable["setDefaultEncoding"];
  // `_write`/`_final` are intentionally NOT declared here (unlike the
  // methods above): Transform overrides them as real class methods, and
  // TypeScript forbids a subclass method overriding a `declare`d property
  // of function type. They're still assigned onto the prototype by the
  // mixin loop below and set as instance overrides in the constructor —
  // just under a loosely-typed alias so both this class and Transform can
  // each declare `_write`/`_final` their own way.

  constructor(options: DuplexOptions = {}) {
    super(options);
    this._allowHalfOpen = options.allowHalfOpen ?? true;
    this.writableObjectMode = !!options.objectMode;
    this.writableHighWaterMark =
      options.highWaterMark ?? (this.writableObjectMode ? 16 : 16384);
    this._wstate = {
      length: 0,
      corked: 0,
      writing: false,
      ending: false,
      finished: false,
      finishStarted: false,
      needDrain: false,
      defaultEncoding: options.defaultEncoding ?? "utf8",
      buffered: [],
    };

    const self = this as unknown as {
      _write: (chunk: unknown, encoding: string | undefined, callback: ErrCallback) => void;
      _final: (callback: ErrCallback) => void;
    };
    if (options.write) {
      self._write = options.write.bind(this);
    }
    if (options.final) {
      self._final = options.final.bind(this);
    }
  }

  protected override _onReadableEnd(): void {
    if (!this._allowHalfOpen) {
      this.end();
    }
  }
}

for (const name of WRITABLE_MIXIN_METHODS) {
  (Duplex.prototype as unknown as Record<string, unknown>)[name] = (
    Writable.prototype as unknown as Record<string, unknown>
  )[name];
}
Object.defineProperty(Duplex.prototype, "writable", {
  get(this: Duplex): boolean {
    return !this.destroyed && !(this as unknown as { _wstate: { ending: boolean } })._wstate.ending;
  },
});
Object.defineProperty(Duplex.prototype, "writableLength", {
  get: Object.getOwnPropertyDescriptor(Writable.prototype, "writableLength")!.get,
});
Object.defineProperty(Duplex.prototype, "writableCorked", {
  get: Object.getOwnPropertyDescriptor(Writable.prototype, "writableCorked")!.get,
});
Object.defineProperty(Duplex.prototype, "writableFinished", {
  get: Object.getOwnPropertyDescriptor(Writable.prototype, "writableFinished")!.get,
});

export interface TransformOptions extends DuplexOptions {
  transform?: (
    this: Transform,
    chunk: unknown,
    encoding: string | undefined,
    callback: (error?: Error | null, data?: unknown) => void,
  ) => void;
  flush?: (
    this: Transform,
    callback: (error?: Error | null, data?: unknown) => void,
  ) => void;
}

export class Transform extends Duplex {
  private _transformFn?: TransformOptions["transform"];
  private _flushFn?: TransformOptions["flush"];

  constructor(options: TransformOptions = {}) {
    super({ ...options, read: options.read ?? ((): void => {}) });
    if (options.transform) {
      this._transformFn = options.transform.bind(this);
    }
    if (options.flush) {
      this._flushFn = options.flush.bind(this);
    }
  }

  _transform(
    chunk: unknown,
    encoding: string | undefined,
    callback: (error?: Error | null, data?: unknown) => void,
  ): void {
    if (this._transformFn) {
      this._transformFn(chunk, encoding, callback);
    } else {
      callback(null, chunk);
    }
  }

  _flush(callback: (error?: Error | null, data?: unknown) => void): void {
    if (this._flushFn) {
      this._flushFn(callback);
    } else {
      callback();
    }
  }

  _write(chunk: unknown, encoding: string | undefined, callback: ErrCallback): void {
    try {
      this._transform(chunk, encoding, (err, data) => {
        if (err) {
          callback(err);
          return;
        }
        if (data !== undefined && data !== null) {
          this.push(data);
        }
        callback();
      });
    } catch (err) {
      callback(err as Error);
    }
  }

  _final(callback: ErrCallback): void {
    this._flush((err, data) => {
      if (err) {
        callback(err);
        return;
      }
      if (data !== undefined && data !== null) {
        this.push(data);
      }
      this.push(null);
      callback();
    });
  }
}

export class PassThrough extends Transform {
  constructor(options: TransformOptions = {}) {
    super({
      ...options,
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
  }
}

type PipelineStream = Readable | Writable | Duplex | Transform;

export function pipeline(
  ...args: [...PipelineStream[], (error?: Error | null) => void] | [PipelineStream[], (error?: Error | null) => void]
): PipelineStream {
  const rest = args as unknown[];
  let callback: (error?: Error | null) => void = () => {};
  const last = rest[rest.length - 1];
  let items: unknown[] = rest;
  if (typeof last === "function") {
    callback = last as (error?: Error | null) => void;
    items = rest.slice(0, -1);
  }

  const streams: PipelineStream[] =
    items.length === 1 && Array.isArray(items[0])
      ? (items[0] as PipelineStream[])
      : (items as PipelineStream[]);

  let errored = false;
  const onError = (err: Error): void => {
    if (errored) {
      return;
    }
    errored = true;
    for (const s of streams) {
      if (!s.destroyed) {
        s.destroy(err);
      }
    }
    callback(err);
  };

  for (let i = 0; i < streams.length; i++) {
    streams[i].on("error", onError);
  }
  for (let i = 0; i < streams.length - 1; i++) {
    const src = streams[i] as Readable;
    const dest = streams[i + 1] as unknown as WritableLike;
    src.pipe(dest);
  }

  const lastStream = streams[streams.length - 1] as Writable;
  lastStream.on("finish", () => {
    if (!errored) {
      callback();
    }
  });

  return lastStream;
}

interface StreamModule {
  Stream: typeof Stream;
  Readable: typeof Readable;
  Writable: typeof Writable;
  Duplex: typeof Duplex;
  Transform: typeof Transform;
  PassThrough: typeof PassThrough;
  pipeline: typeof pipeline;
}

const streamModule: StreamModule = {
  Stream,
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
};

export default streamModule;
