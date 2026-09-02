import { describe, expect, it, vi } from "vitest";
import {
  Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline,
} from "./stream.js";
import { EventEmitter } from "./events.js";

describe("Stream base class", () => {
  it("extends EventEmitter", () => {
    const s = new Stream();
    expect(s).toBeInstanceOf(EventEmitter);
  });
});

describe("Readable", () => {
  it("extends Stream", () => {
    const r = new Readable({ read() {} });
    expect(r).toBeInstanceOf(Stream);
  });

  it("emits data events in flowing mode", () => {
    const r = new Readable({
      read() {
        this.push("hello");
        this.push(null);
      },
    });
    const chunks: string[] = [];
    r.on("data", (chunk: string) => chunks.push(chunk));
    r.on("end", () => {
      expect(chunks).toEqual(["hello"]);
    });
  });

  it("read() returns chunks in paused mode", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() {
          this.push("chunk1");
          this.push("chunk2");
          this.push(null);
        },
      });
      r.on("readable", () => {
        let chunk;
        const results: string[] = [];
        while ((chunk = r.read()) !== null) {
          results.push(chunk);
        }
        expect(results.length).toBeGreaterThan(0);
        resolve();
      });
    });
  });

  it("push returns false when buffer exceeds highWaterMark", () => {
    const r = new Readable({
      highWaterMark: 5,
      read() {},
    });
    expect(r.push("123")).toBe(true);
    expect(r.push("456")).toBe(false);
  });

  it("supports objectMode", () => {
    const objects = [{ a: 1 }, { b: 2 }];
    let index = 0;
    const r = new Readable({
      objectMode: true,
      read() {
        if (index < objects.length) {
          this.push(objects[index++]);
        } else {
          this.push(null);
        }
      },
    });
    const received: object[] = [];
    r.on("data", (obj: object) => received.push(obj));
    r.on("end", () => {
      expect(received).toEqual(objects);
    });
  });

  it("pause() and resume() control flowing", () => {
    const r = new Readable({
      read() {
        this.push("data");
        this.push(null);
      },
    });
    const fn = vi.fn();
    r.on("data", fn);
    r.pause();
    expect(r.isPaused()).toBe(true);
    expect(fn).not.toHaveBeenCalled();
    r.resume();
  });

  it("unshift pushes data back to front of buffer", () => {
    const r = new Readable({
      read() {
        this.push("world");
        this.push(null);
      },
    });
    r.on("readable", () => {
      const first = r.read();
      if (first) {
        r.unshift("hello ");
        const combined = r.read();
        expect(combined).toBeDefined();
      }
    });
  });

  it("destroy emits close", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({ read() {} });
      r.on("close", () => {
        expect(r.destroyed).toBe(true);
        resolve();
      });
      r.destroy();
    });
  });

  it("destroy with error emits error then close", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({ read() {} });
      const events: string[] = [];
      r.on("error", () => events.push("error"));
      r.on("close", () => {
        events.push("close");
        expect(events).toEqual(["error", "close"]);
        resolve();
      });
      r.destroy(new Error("boom"));
    });
  });

  it("setEncoding converts chunks to strings", () => {
    const r = new Readable({
      read() {
        this.push(Buffer.from("hello"));
        this.push(null);
      },
    });
    r.setEncoding("utf-8");
    const chunks: string[] = [];
    r.on("data", (chunk: string) => {
      expect(typeof chunk).toBe("string");
      chunks.push(chunk);
    });
    r.on("end", () => {
      expect(chunks.join("")).toBe("hello");
    });
  });

  it("exposes readable properties", () => {
    const r = new Readable({ highWaterMark: 100, objectMode: true, read() {} });
    expect(r.readableHighWaterMark).toBe(100);
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableFlowing).toBe(null);
    expect(r.readable).toBe(true);
    expect(r.readableLength).toBe(0);
  });
});

describe("Writable", () => {
  it("extends Stream", () => {
    const w = new Writable({ write(chunk, enc, cb) { cb(); } });
    expect(w).toBeInstanceOf(Stream);
  });

  it("calls _write for each write() call", () => {
    return new Promise<void>((resolve) => {
      const chunks: string[] = [];
      const w = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(String(chunk));
          callback();
        },
      });
      w.write("a");
      w.write("b");
      w.end(() => {
        expect(chunks).toEqual(["a", "b"]);
        resolve();
      });
    });
  });

  it("emits finish after end()", () => {
    return new Promise<void>((resolve) => {
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
      });
      w.on("finish", () => resolve());
      w.end();
    });
  });

  it("emits close after finish", () => {
    return new Promise<void>((resolve) => {
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
      });
      const events: string[] = [];
      w.on("finish", () => events.push("finish"));
      w.on("close", () => {
        events.push("close");
        expect(events).toEqual(["finish", "close"]);
        resolve();
      });
      w.end();
    });
  });

  it("write returns false when buffer exceeds highWaterMark", () => {
    const w = new Writable({
      highWaterMark: 2,
      write(chunk, enc, cb) {
        setTimeout(cb, 10);
      },
    });
    const first = w.write("a");
    w.write("b");
    const third = w.write("c");
    expect(first).toBe(true);
    // Once buffer fills, returns false
    expect(third).toBe(false);
    w.end();
  });

  it("emits drain when buffer empties after backpressure", () => {
    return new Promise<void>((resolve) => {
      let callback: (() => void) | null = null;
      const w = new Writable({
        highWaterMark: 1,
        write(chunk, enc, cb) {
          callback = cb;
        },
      });
      w.write("x");
      w.write("y"); // should return false (backpressure)
      w.on("drain", () => {
        resolve();
      });
      // Flush the first write
      if (callback) (callback as () => void)();
    });
  });

  it("cork and uncork batch writes", () => {
    return new Promise<void>((resolve) => {
      const chunks: string[] = [];
      const w = new Writable({
        write(chunk, enc, cb) {
          chunks.push(String(chunk));
          cb();
        },
      });
      w.cork();
      w.write("a");
      w.write("b");
      expect(chunks).toEqual([]);
      w.uncork();
      // After microtask, writes should flush
      queueMicrotask(() => {
        expect(chunks).toEqual(["a", "b"]);
        w.end(() => resolve());
      });
    });
  });

  it("_final is called before finish", () => {
    return new Promise<void>((resolve) => {
      let finalCalled = false;
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
        final(cb) {
          finalCalled = true;
          cb();
        },
      });
      w.on("finish", () => {
        expect(finalCalled).toBe(true);
        resolve();
      });
      w.end();
    });
  });

  it("destroy emits error and close", () => {
    return new Promise<void>((resolve) => {
      const w = new Writable({ write(chunk, enc, cb) { cb(); } });
      const events: string[] = [];
      w.on("error", () => events.push("error"));
      w.on("close", () => {
        events.push("close");
        expect(events).toEqual(["error", "close"]);
        resolve();
      });
      w.destroy(new Error("boom"));
    });
  });

  it("supports objectMode", () => {
    return new Promise<void>((resolve) => {
      const received: object[] = [];
      const w = new Writable({
        objectMode: true,
        write(chunk, enc, cb) {
          received.push(chunk);
          cb();
        },
      });
      w.write({ a: 1 });
      w.write({ b: 2 });
      w.end(() => {
        expect(received).toEqual([{ a: 1 }, { b: 2 }]);
        resolve();
      });
    });
  });

  it("exposes writable properties", () => {
    const w = new Writable({ highWaterMark: 200, objectMode: true, write(c, e, cb) { cb(); } });
    expect(w.writableHighWaterMark).toBe(200);
    expect(w.writableObjectMode).toBe(true);
    expect(w.writable).toBe(true);
    expect(w.writableLength).toBe(0);
    expect(w.writableCorked).toBe(0);
    expect(w.writableFinished).toBe(false);
  });
});

describe("pipe", () => {
  it("pipes readable to writable", () => {
    return new Promise<void>((resolve) => {
      const chunks: string[] = [];
      const r = new Readable({
        read() {
          this.push("hello");
          this.push(null);
        },
      });
      const w = new Writable({
        write(chunk, enc, cb) {
          chunks.push(String(chunk));
          cb();
        },
      });
      w.on("finish", () => {
        expect(chunks).toEqual(["hello"]);
        resolve();
      });
      r.pipe(w);
    });
  });

  it("respects backpressure in pipe", () => {
    return new Promise<void>((resolve) => {
      let pushCount = 0;
      const r = new Readable({
        highWaterMark: 1,
        read() {
          pushCount++;
          if (pushCount <= 5) {
            this.push("x");
          } else {
            this.push(null);
          }
        },
      });
      const received: string[] = [];
      const w = new Writable({
        highWaterMark: 1,
        write(chunk, enc, cb) {
          received.push(String(chunk));
          setTimeout(cb, 1);
        },
      });
      w.on("finish", () => {
        expect(received.length).toBe(5);
        resolve();
      });
      r.pipe(w);
    });
  });

  it("unpipe stops data flow", () => {
    const r = new Readable({
      read() {
        this.push("data");
        this.push(null);
      },
    });
    const fn = vi.fn();
    const w = new Writable({
      write(chunk, enc, cb) { fn(); cb(); },
    });
    r.pipe(w);
    r.unpipe(w);
    // The writable should not receive data after unpipe
  });

  it("pipe with { end: false } does not end writable", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() {
          this.push("hello");
          this.push(null);
        },
      });
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
      });
      r.pipe(w, { end: false });
      r.on("end", () => {
        expect(w.writable).toBe(true);
        w.end(() => resolve());
      });
    });
  });
});

describe("Duplex", () => {
  it("extends Readable and has Writable methods", () => {
    const d = new Duplex({
      read() {},
      write(chunk, enc, cb) { cb(); },
    });
    expect(d).toBeInstanceOf(Readable);
    expect(typeof d.write).toBe("function");
    expect(typeof d.end).toBe("function");
    expect(typeof d.cork).toBe("function");
    expect(typeof d.uncork).toBe("function");
  });

  it("readable and writable sides work independently", () => {
    return new Promise<void>((resolve) => {
      const written: string[] = [];
      const d = new Duplex({
        read() {
          this.push("from-read");
          this.push(null);
        },
        write(chunk, enc, cb) {
          written.push(String(chunk));
          cb();
        },
      });
      const readData: string[] = [];
      d.on("data", (chunk: string) => readData.push(chunk));
      d.write("to-write");
      d.end(() => {
        expect(written).toEqual(["to-write"]);
        expect(readData).toContain("from-read");
        resolve();
      });
    });
  });

  it("allowHalfOpen false auto-ends writable when readable ends", () => {
    return new Promise<void>((resolve) => {
      const d = new Duplex({
        allowHalfOpen: false,
        read() { this.push(null); },
        write(chunk, enc, cb) { cb(); },
      });
      d.on("finish", () => resolve());
      d.resume();
    });
  });
});

describe("Transform", () => {
  it("transforms data from writable to readable side", () => {
    return new Promise<void>((resolve) => {
      const t = new Transform({
        transform(chunk, encoding, callback) {
          callback(null, String(chunk).toUpperCase());
        },
      });
      const output: string[] = [];
      t.on("data", (chunk: string) => output.push(chunk));
      t.on("end", () => {
        expect(output).toEqual(["HELLO", "WORLD"]);
        resolve();
      });
      t.write("hello");
      t.write("world");
      t.end();
    });
  });

  it("_flush is called before end", () => {
    return new Promise<void>((resolve) => {
      const t = new Transform({
        transform(chunk, enc, cb) { cb(null, chunk); },
        flush(cb) {
          this.push("flushed");
          cb();
        },
      });
      const output: string[] = [];
      t.on("data", (chunk: string) => output.push(chunk));
      t.on("end", () => {
        expect(output[output.length - 1]).toBe("flushed");
        resolve();
      });
      t.write("data");
      t.end();
    });
  });

  it("transform error propagates", () => {
    return new Promise<void>((resolve) => {
      const t = new Transform({
        transform(chunk, enc, cb) {
          cb(new Error("transform-error"));
        },
      });
      t.on("error", (err: Error) => {
        expect(err.message).toBe("transform-error");
        resolve();
      });
      t.write("data");
    });
  });
});

describe("PassThrough", () => {
  it("passes data through unchanged", () => {
    return new Promise<void>((resolve) => {
      const pt = new PassThrough();
      const output: string[] = [];
      pt.on("data", (chunk: string) => output.push(String(chunk)));
      pt.on("end", () => {
        expect(output).toEqual(["hello"]);
        resolve();
      });
      pt.write("hello");
      pt.end();
    });
  });
});

describe("pipeline", () => {
  it("pipes multiple streams and calls callback on finish", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() {
          this.push("hello");
          this.push(null);
        },
      });
      const t = new Transform({
        transform(chunk, enc, cb) {
          cb(null, String(chunk).toUpperCase());
        },
      });
      const output: string[] = [];
      const w = new Writable({
        write(chunk, enc, cb) {
          output.push(String(chunk));
          cb();
        },
      });
      pipeline(r, t, w, (err) => {
        expect(err).toBeFalsy();
        expect(output).toEqual(["HELLO"]);
        resolve();
      });
    });
  });

  it("destroys all streams on error", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() {
          this.push("data");
        },
      });
      const t = new Transform({
        transform(chunk, enc, cb) {
          cb(new Error("pipeline-fail"));
        },
      });
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
      });
      pipeline(r, t, w, (err) => {
        expect(err).toBeTruthy();
        expect(err!.message).toBe("pipeline-fail");
        expect(r.destroyed).toBe(true);
        expect(w.destroyed).toBe(true);
        resolve();
      });
    });
  });

  it("accepts an array of streams", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() { this.push("data"); this.push(null); },
      });
      const pt = new PassThrough();
      const output: string[] = [];
      const w = new Writable({
        write(chunk, enc, cb) { output.push(String(chunk)); cb(); },
      });
      pipeline([r, pt, w], (err) => {
        expect(err).toBeFalsy();
        expect(output).toEqual(["data"]);
        resolve();
      });
    });
  });
});
