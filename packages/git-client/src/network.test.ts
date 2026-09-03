// packages/git-client/src/network.test.ts
//
// isomorphic-git has no built-in "local filesystem" remote transport — every
// git.push/git.clone/git.fetch call requires a real smart-HTTP `http` client,
// even when the "remote" happens to live in the same in-memory VFS. Rather
// than standing up an HTTP server, these tests simulate network operations by
// copying git objects and updating refs directly between directories in the
// same VFS (the same technique the old "dumb" HTTP transport used). This
// keeps the tests free of real network I/O while still exercising GitClient's
// commit/branch/log/remote plumbing end-to-end.

import { describe, it, expect, beforeEach } from "vitest";
import git from "isomorphic-git";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createFsAdapter } from "./fs-adapter.js";
import { GitClient } from "./client.js";
import type { IGitHttpClient } from "./types.js";

const dummyHttp: IGitHttpClient = {
  request: () => Promise.reject(new Error("no network")),
};

const testAuthor = { name: "Test", email: "test@test.com" };

async function listFilesRecursive(vfs: InstanceType<typeof MemoryFS>, dir: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await vfs.readdir(d);
    for (const entry of entries) {
      const full = `${d}/${entry}`;
      const st = await vfs.lstat(full);
      if (st.type === "directory") {
        await walk(full);
      } else {
        result.push(full);
      }
    }
  }
  await walk(dir);
  return result;
}

async function copyObjects(
  vfs: InstanceType<typeof MemoryFS>,
  srcObjectsDir: string,
  dstObjectsDir: string,
): Promise<void> {
  let files: string[];
  try {
    files = await listFilesRecursive(vfs, srcObjectsDir);
  } catch {
    return;
  }
  for (const file of files) {
    const rel = file.slice(srcObjectsDir.length + 1);
    const dstFile = `${dstObjectsDir}/${rel}`;
    const dstDir = dstFile.slice(0, dstFile.lastIndexOf("/"));
    await vfs.mkdir(dstDir, { recursive: true });
    const data = await vfs.readFile(file);
    await vfs.writeFile(dstFile, data);
  }
}

/** Simulates `git push` from a non-bare working dir to a bare "remote" dir. */
async function simulatePush(
  vfs: InstanceType<typeof MemoryFS>,
  fs: ReturnType<typeof createFsAdapter>,
  workDir: string,
  remoteDir: string,
  branch = "main",
): Promise<void> {
  await copyObjects(vfs, `${workDir}/.git/objects`, `${remoteDir}/objects`);
  const oid = await git.resolveRef({ fs, dir: workDir, ref: branch });
  await git.writeRef({ fs, gitdir: remoteDir, ref: `refs/heads/${branch}`, value: oid, force: true });
  await git.writeRef({ fs, dir: workDir, ref: `refs/remotes/origin/${branch}`, value: oid, force: true });
}

/** Simulates `git clone` of a bare "remote" dir into a fresh non-bare dir. */
async function simulateClone(
  vfs: InstanceType<typeof MemoryFS>,
  fs: ReturnType<typeof createFsAdapter>,
  remoteDir: string,
  cloneDir: string,
  branch = "main",
): Promise<void> {
  await git.init({ fs, dir: cloneDir, defaultBranch: branch });
  await copyObjects(vfs, `${remoteDir}/objects`, `${cloneDir}/.git/objects`);
  const oid = await git.resolveRef({ fs, gitdir: remoteDir, ref: `refs/heads/${branch}` });
  await git.writeRef({ fs, dir: cloneDir, ref: `refs/heads/${branch}`, value: oid, force: true });
  await git.writeRef({ fs, dir: cloneDir, ref: `refs/remotes/origin/${branch}`, value: oid, force: true });
  await git.checkout({ fs, dir: cloneDir, ref: branch });
}

/** Simulates `git fetch`: pulls new objects and updates the remote-tracking ref only. */
async function simulateFetch(
  vfs: InstanceType<typeof MemoryFS>,
  fs: ReturnType<typeof createFsAdapter>,
  remoteDir: string,
  cloneDir: string,
  branch = "main",
): Promise<void> {
  await copyObjects(vfs, `${remoteDir}/objects`, `${cloneDir}/.git/objects`);
  const oid = await git.resolveRef({ fs, gitdir: remoteDir, ref: `refs/heads/${branch}` });
  await git.writeRef({ fs, dir: cloneDir, ref: `refs/remotes/origin/${branch}`, value: oid, force: true });
}

describe("GitClient network operations (in-memory)", () => {
  let vfs: InstanceType<typeof MemoryFS>;
  let fs: ReturnType<typeof createFsAdapter>;

  beforeEach(async () => {
    vfs = new MemoryFS();
    fs = createFsAdapter(vfs);
  });

  it("push to bare repo and clone from it", async () => {
    await vfs.mkdir("/origin", { recursive: true });
    await git.init({ fs, dir: "/origin", bare: true, defaultBranch: "main" });

    await vfs.mkdir("/work", { recursive: true });
    const client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/work", author: testAuthor });
    await client.init();
    await vfs.writeFile("/work/readme.txt", "hello");
    await client.add("readme.txt");
    await client.commit("first commit");
    await client.addRemote("origin", "/origin");

    await simulatePush(vfs, fs, "/work", "/origin");

    await vfs.mkdir("/clone", { recursive: true });
    await simulateClone(vfs, fs, "/origin", "/clone");
    const cloneClient = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/clone", author: testAuthor });

    const entries = await cloneClient.log();
    expect(entries.length).toBe(1);
    expect(entries[0].commit.message).toBe("first commit\n");

    const content = await vfs.readFile("/clone/readme.txt");
    expect(new TextDecoder().decode(content)).toBe("hello");
  });

  it("fetch pulls new commits from bare remote", async () => {
    await vfs.mkdir("/origin", { recursive: true });
    await git.init({ fs, dir: "/origin", bare: true, defaultBranch: "main" });

    await vfs.mkdir("/work", { recursive: true });
    const workClient = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/work", author: testAuthor });
    await workClient.init();
    await vfs.writeFile("/work/file.txt", "v1");
    await workClient.add("file.txt");
    await workClient.commit("v1");
    await workClient.addRemote("origin", "/origin");
    await simulatePush(vfs, fs, "/work", "/origin");

    await vfs.mkdir("/clone", { recursive: true });
    await simulateClone(vfs, fs, "/origin", "/clone");

    await vfs.writeFile("/work/file.txt", "v2");
    await workClient.add("file.txt");
    await workClient.commit("v2");
    await simulatePush(vfs, fs, "/work", "/origin");

    await simulateFetch(vfs, fs, "/origin", "/clone");
    const entries = await git.log({ fs, dir: "/clone", ref: "origin/main" });
    expect(entries.length).toBe(2);
  });

  it("remotes CRUD", async () => {
    await vfs.mkdir("/repo", { recursive: true });
    const client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/repo", author: testAuthor });
    await client.init();

    await client.addRemote("origin", "https://github.com/user/repo.git");
    await client.addRemote("upstream", "https://github.com/org/repo.git");

    let remotes = await client.listRemotes();
    expect(remotes.length).toBe(2);

    await client.deleteRemote("upstream");
    remotes = await client.listRemotes();
    expect(remotes.length).toBe(1);
    expect(remotes[0].name).toBe("origin");
  });
});

// The simulation helpers above exercise git plumbing but never call
// GitClient.clone()/push()/fetch()/pull() themselves, so those four public
// methods had zero coverage. These tests call the real methods against a
// mock IGitHttpClient that always returns HTTP 401, which is enough to
// verify (a) each method actually forwards to isomorphic-git with the
// configured http adapter and the right smart-HTTP service endpoint, (b)
// `onAuth` is invoked with the remote URL when the server challenges for
// credentials, and (c) the resulting HTTP error propagates out of the
// GitClient method rather than being swallowed.
describe("GitClient network method wiring", () => {
  function createAuthChallengingHttp(): { http: IGitHttpClient; calls: { url: string; method: string }[] } {
    const calls: { url: string; method: string }[] = [];
    const http: IGitHttpClient = {
      request: async (config) => {
        calls.push({ url: config.url, method: config.method });
        return {
          url: config.url,
          method: config.method,
          statusCode: 401,
          statusMessage: "Unauthorized",
          headers: {},
          body: [],
        };
      },
    };
    return { http, calls };
  }

  it("clone() calls through to isomorphic-git with the configured http client and invokes onAuth", async () => {
    const vfs = new MemoryFS();
    const fs = createFsAdapter(vfs);
    await vfs.mkdir("/cloned", { recursive: true });
    const { http, calls } = createAuthChallengingHttp();
    const authCalls: string[] = [];
    const client = new GitClient({
      fs: fs.promises,
      http,
      dir: "/cloned",
      author: testAuthor,
      onAuth: async (url) => {
        authCalls.push(url);
        return { username: "u", password: "p" };
      },
    });

    await expect(client.clone("https://example.com/repo.git")).rejects.toThrow();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("https://example.com/repo.git/info/refs?service=git-upload-pack");
    expect(authCalls).toEqual(["https://example.com/repo.git"]);
  });

  it("fetch() calls through to isomorphic-git with the configured http client and invokes onAuth", async () => {
    const vfs = new MemoryFS();
    const fs = createFsAdapter(vfs);
    await vfs.mkdir("/repo", { recursive: true });
    const { http, calls } = createAuthChallengingHttp();
    const authCalls: string[] = [];
    const client = new GitClient({
      fs: fs.promises,
      http,
      dir: "/repo",
      author: testAuthor,
      onAuth: async (url) => {
        authCalls.push(url);
        return { username: "u", password: "p" };
      },
    });
    await client.init();
    await client.addRemote("origin", "https://example.com/repo.git");

    await expect(client.fetch({ remote: "origin" })).rejects.toThrow();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toContain("https://example.com/repo.git/info/refs?service=git-upload-pack");
    expect(authCalls).toEqual(["https://example.com/repo.git"]);
  });

  it("push() calls through to isomorphic-git with the configured http client and invokes onAuth", async () => {
    const vfs = new MemoryFS();
    const fs = createFsAdapter(vfs);
    await vfs.mkdir("/repo", { recursive: true });
    const { http, calls } = createAuthChallengingHttp();
    const authCalls: string[] = [];
    const client = new GitClient({
      fs: fs.promises,
      http,
      dir: "/repo",
      author: testAuthor,
      onAuth: async (url) => {
        authCalls.push(url);
        return { username: "u", password: "p" };
      },
    });
    await client.init();
    await vfs.writeFile("/repo/a.txt", "hi");
    await client.add("a.txt");
    await client.commit("init");
    await client.addRemote("origin", "https://example.com/repo.git");

    await expect(client.push({ remote: "origin" })).rejects.toThrow();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toContain("https://example.com/repo.git/info/refs?service=git-receive-pack");
    expect(authCalls).toEqual(["https://example.com/repo.git"]);
  });

  it("pull() calls through to isomorphic-git with the configured http client and invokes onAuth", async () => {
    const vfs = new MemoryFS();
    const fs = createFsAdapter(vfs);
    await vfs.mkdir("/repo", { recursive: true });
    const { http, calls } = createAuthChallengingHttp();
    const authCalls: string[] = [];
    const client = new GitClient({
      fs: fs.promises,
      http,
      dir: "/repo",
      author: testAuthor,
      onAuth: async (url) => {
        authCalls.push(url);
        return { username: "u", password: "p" };
      },
    });
    await client.init();
    await vfs.writeFile("/repo/a.txt", "hi");
    await client.add("a.txt");
    await client.commit("init");
    await client.addRemote("origin", "https://example.com/repo.git");

    await expect(client.pull({ remote: "origin" })).rejects.toThrow();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toContain("https://example.com/repo.git/info/refs?service=git-upload-pack");
    expect(authCalls).toEqual(["https://example.com/repo.git"]);
  });
});
