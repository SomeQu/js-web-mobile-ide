import { describe, expect, it } from "vitest";
import os, {
  EOL,
  arch,
  cpus,
  endianness,
  freemem,
  homedir,
  hostname,
  networkInterfaces,
  platform,
  tmpdir,
  totalmem,
  type,
  userInfo,
} from "./os.js";

describe("os stubs", () => {
  it("returns fixed platform/arch/type values", () => {
    expect(platform()).toBe("darwin");
    expect(arch()).toBe("arm64");
    expect(type()).toBe("Darwin");
  });

  it("returns fixed EOL/tmpdir/homedir", () => {
    expect(EOL).toBe("\n");
    expect(tmpdir()).toBe("/tmp");
    expect(homedir()).toBe("/home/user");
  });

  it("returns a non-empty cpus array", () => {
    const list = cpus();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("returns positive memory values", () => {
    expect(totalmem()).toBeGreaterThan(0);
    expect(freemem()).toBeGreaterThan(0);
  });

  it("returns LE endianness", () => {
    expect(endianness()).toBe("LE");
  });

  it("returns localhost hostname", () => {
    expect(hostname()).toBe("localhost");
  });

  it("returns userInfo with expected shape", () => {
    const info = userInfo();
    expect(info).toHaveProperty("username");
    expect(info).toHaveProperty("uid");
    expect(info).toHaveProperty("gid");
    expect(info).toHaveProperty("shell");
    expect(info).toHaveProperty("homedir");
  });

  it("returns an empty networkInterfaces object", () => {
    expect(networkInterfaces()).toEqual({});
  });
});

describe("os default export", () => {
  it("has all functions and constants", () => {
    expect(os.platform).toBe(platform);
    expect(os.arch).toBe(arch);
    expect(os.EOL).toBe(EOL);
    expect(os.cpus).toBe(cpus);
    expect(os.userInfo).toBe(userInfo);
    expect(os.networkInterfaces).toBe(networkInterfaces);
  });
});
