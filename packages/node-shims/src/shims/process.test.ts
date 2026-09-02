/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from "vitest";
import process from "./process.js";

describe("process.env", () => {
  it("is a writable object", () => {
    process.env.FOO = "bar";
    expect(process.env.FOO).toBe("bar");
  });
});

describe("process.cwd / chdir", () => {
  afterEach(() => {
    process.chdir("/");
  });

  it("starts at /", () => {
    expect(process.cwd()).toBe("/");
  });

  it("chdir updates cwd", () => {
    process.chdir("/home");
    expect(process.cwd()).toBe("/home");
  });
});

describe("process.nextTick", () => {
  it("calls the callback asynchronously", async () => {
    const fn = vi.fn();
    process.nextTick(fn);
    expect(fn).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("forwards extra arguments", async () => {
    const fn = vi.fn();
    process.nextTick(fn, 1, 2);
    await Promise.resolve();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledWith(1, 2);
  });
});

describe("process constants", () => {
  it("platform is browser", () => {
    expect(process.platform).toBe("browser");
  });

  it("arch is arm64", () => {
    expect(process.arch).toBe("arm64");
  });

  it("version matches vN", () => {
    expect(process.version).toMatch(/^v\d+/);
  });

  it("pid is a number", () => {
    expect(typeof process.pid).toBe("number");
  });

  it("browser is true", () => {
    expect(process.browser).toBe(true);
  });

  it("title is browser", () => {
    expect(process.title).toBe("browser");
  });
});

describe("process.exit", () => {
  it("throws instead of exiting", () => {
    expect(() => process.exit()).toThrow();
    expect(() => process.exit(1)).toThrow();
  });
});

describe("process.stdout / stderr", () => {
  it("stdout.write logs and returns true", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(process.stdout.write("x")).toBe(true);
    expect(spy).toHaveBeenCalledWith("x");
    spy.mockRestore();
  });

  it("stderr.write logs and returns true", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(process.stderr.write("x")).toBe(true);
    expect(spy).toHaveBeenCalledWith("x");
    spy.mockRestore();
  });
});

describe("process.hrtime", () => {
  it("returns a [seconds, nanoseconds] tuple", () => {
    const [seconds, nanos] = process.hrtime();
    expect(typeof seconds).toBe("number");
    expect(typeof nanos).toBe("number");
  });

  it("subtracts a previous hrtime", () => {
    const start = process.hrtime();
    const diff = process.hrtime(start);
    expect(diff[0]).toBeGreaterThanOrEqual(0);
  });

  it("bigint() returns a bigint", () => {
    expect(typeof process.hrtime.bigint()).toBe("bigint");
  });
});

describe("process default export", () => {
  it("is the process object", () => {
    expect(process.env).toBeDefined();
    expect(process.cwd).toBeInstanceOf(Function);
  });
});
