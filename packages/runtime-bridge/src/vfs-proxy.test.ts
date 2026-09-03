// packages/runtime-bridge/src/vfs-proxy.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { VfsProxy } from "./vfs-proxy.js";
import { createRequest } from "./protocol.js";
import type { Response } from "./types.js";

describe("VfsProxy", () => {
  let vfs: InstanceType<typeof MemoryFS>;
  let proxy: VfsProxy;

  beforeEach(async () => {
    vfs = new MemoryFS();
    proxy = new VfsProxy(vfs);
  });

  it("readFile / writeFile roundtrip with base64", async () => {
    const content = new TextEncoder().encode("hello world");
    const b64 = btoa(String.fromCharCode(...content));

    const writeReq = createRequest("vfs.writeFile", { path: "/test.txt", data: b64 });
    const writeRes = await proxy.handleRequest(writeReq);
    expect(writeRes.result).toEqual({ ok: true });

    const readReq = createRequest("vfs.readFile", { path: "/test.txt" });
    const readRes = await proxy.handleRequest(readReq);
    const decoded = atob((readRes.result as any).data);
    expect(decoded).toBe("hello world");
  });

  it("readdir lists entries", async () => {
    await vfs.writeFile("/a.txt", new Uint8Array([65]));
    await vfs.writeFile("/b.txt", new Uint8Array([66]));
    const req = createRequest("vfs.readdir", { path: "/" });
    const res = await proxy.handleRequest(req);
    expect((res.result as any).entries).toContain("a.txt");
    expect((res.result as any).entries).toContain("b.txt");
  });

  it("stat returns file info", async () => {
    await vfs.writeFile("/file.txt", new Uint8Array([1, 2, 3]));
    const req = createRequest("vfs.stat", { path: "/file.txt" });
    const res = await proxy.handleRequest(req);
    expect((res.result as any).type).toBe("file");
    expect((res.result as any).size).toBe(3);
  });

  it("mkdir and rmdir", async () => {
    const mkReq = createRequest("vfs.mkdir", { path: "/dir" });
    expect((await proxy.handleRequest(mkReq)).result).toEqual({ ok: true });

    const statReq = createRequest("vfs.stat", { path: "/dir" });
    expect((await proxy.handleRequest(statReq)).result).toHaveProperty("type", "directory");

    const rmReq = createRequest("vfs.rmdir", { path: "/dir" });
    expect((await proxy.handleRequest(rmReq)).result).toEqual({ ok: true });
  });

  it("mkdir recursive", async () => {
    const req = createRequest("vfs.mkdir", { path: "/a/b/c", recursive: true });
    const res = await proxy.handleRequest(req);
    expect(res.result).toEqual({ ok: true });
    expect(await vfs.exists("/a/b/c")).toBe(true);
  });

  it("unlink removes file", async () => {
    await vfs.writeFile("/rm.txt", new Uint8Array([1]));
    const req = createRequest("vfs.unlink", { path: "/rm.txt" });
    expect((await proxy.handleRequest(req)).result).toEqual({ ok: true });
    expect(await vfs.exists("/rm.txt")).toBe(false);
  });

  it("rename moves file", async () => {
    await vfs.writeFile("/old.txt", new TextEncoder().encode("data"));
    const req = createRequest("vfs.rename", { oldPath: "/old.txt", newPath: "/new.txt" });
    expect((await proxy.handleRequest(req)).result).toEqual({ ok: true });
    expect(await vfs.exists("/new.txt")).toBe(true);
    expect(await vfs.exists("/old.txt")).toBe(false);
  });

  it("exists returns boolean", async () => {
    const req1 = createRequest("vfs.exists", { path: "/nope" });
    expect((await proxy.handleRequest(req1)).result).toEqual({ exists: false });

    await vfs.writeFile("/yes.txt", new Uint8Array([1]));
    const req2 = createRequest("vfs.exists", { path: "/yes.txt" });
    expect((await proxy.handleRequest(req2)).result).toEqual({ exists: true });
  });

  it("symlink and readlink", async () => {
    await vfs.writeFile("/target.txt", new Uint8Array([1]));
    const symReq = createRequest("vfs.symlink", { target: "/target.txt", path: "/link" });
    expect((await proxy.handleRequest(symReq)).result).toEqual({ ok: true });

    const readReq = createRequest("vfs.readlink", { path: "/link" });
    expect((await proxy.handleRequest(readReq)).result).toEqual({ target: "/target.txt" });
  });

  it("lstat returns symlink type", async () => {
    await vfs.writeFile("/tgt.txt", new Uint8Array([1]));
    await vfs.symlink("/tgt.txt", "/sl");
    const req = createRequest("vfs.lstat", { path: "/sl" });
    const res = await proxy.handleRequest(req);
    expect((res.result as any).type).toBe("symlink");
  });

  it("returns VFS_ERROR on file not found", async () => {
    const req = createRequest("vfs.readFile", { path: "/missing" });
    const res = await proxy.handleRequest(req);
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("VFS_ERROR");
  });

  it("returns VFS_ERROR on unknown method", async () => {
    const req = createRequest("vfs.unknown", {});
    const res = await proxy.handleRequest(req);
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("VFS_ERROR");
    expect(res.error!.message).toContain("Unknown VFS method");
  });
});
