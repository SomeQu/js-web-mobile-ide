// packages/git-client/src/client.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createFsAdapter } from "./fs-adapter.js";
import { GitClient } from "./client.js";
import type { IGitHttpClient } from "./types.js";

const dummyHttp: IGitHttpClient = {
  request: () => Promise.reject(new Error("no network in local tests")),
};

const testAuthor = { name: "Test User", email: "test@example.com" };

describe("GitClient local operations", () => {
  let vfs: InstanceType<typeof MemoryFS>;
  let client: GitClient;

  beforeEach(async () => {
    vfs = new MemoryFS();
    await vfs.mkdir("/repo", { recursive: true });
    const fs = createFsAdapter(vfs);
    client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/repo", author: testAuthor });
  });

  describe("init", () => {
    it("creates .git directory", async () => {
      await client.init();
      const stat = await vfs.stat("/repo/.git");
      expect(stat.type).toBe("directory");
    });
  });

  describe("add + commit + log", () => {
    it("commits a file and returns oid", async () => {
      await client.init();
      await vfs.writeFile("/repo/hello.txt", "hello world");
      await client.add("hello.txt");
      const oid = await client.commit("initial commit");
      expect(typeof oid).toBe("string");
      expect(oid.length).toBe(40);
    });

    it("log returns commit history", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "v1");
      await client.add("file.txt");
      await client.commit("first");

      await vfs.writeFile("/repo/file.txt", "v2");
      await client.add("file.txt");
      await client.commit("second");

      const entries = await client.log();
      expect(entries.length).toBe(2);
      expect(entries[0].commit.message).toBe("second\n");
      expect(entries[1].commit.message).toBe("first\n");
    });

    it("log with depth limits results", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "v1");
      await client.add("file.txt");
      await client.commit("first");

      await vfs.writeFile("/repo/file.txt", "v2");
      await client.add("file.txt");
      await client.commit("second");

      const entries = await client.log({ depth: 1 });
      expect(entries.length).toBe(1);
    });
  });

  describe("status", () => {
    it("reports new untracked file", async () => {
      await client.init();
      await vfs.writeFile("/repo/new.txt", "content");
      const row = await client.status("new.txt");
      expect(row.filepath).toBe("new.txt");
      expect(row.head).toBe(0);
      expect(row.workdir).toBe(2);
      expect(row.stage).toBe(0);
    });

    it("statusAll returns all files", async () => {
      await client.init();
      await vfs.writeFile("/repo/a.txt", "a");
      await vfs.writeFile("/repo/b.txt", "b");
      const rows = await client.statusAll();
      expect(rows.length).toBe(2);
      expect(rows.map(r => r.filepath).sort()).toEqual(["a.txt", "b.txt"]);
    });
  });

  describe("remove", () => {
    it("unstages a file", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.remove("file.txt");
      const row = await client.status("file.txt");
      expect(row.stage).toBe(0);
    });
  });

  describe("branches", () => {
    it("creates and lists branches", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      await client.branch("feature");
      const branches = await client.listBranches();
      const names = branches.map(b => b.name).sort();
      expect(names).toContain("main");
      expect(names).toContain("feature");
    });

    it("currentBranch returns current branch name", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      const current = await client.currentBranch();
      expect(current).toBe("main");
    });

    it("checkout switches branch", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      await client.branch("feature");
      await client.checkout("feature");
      expect(await client.currentBranch()).toBe("feature");
    });

    it("deleteBranch removes branch", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      await client.branch("feature");
      await client.deleteBranch("feature");
      const branches = await client.listBranches();
      expect(branches.map(b => b.name)).not.toContain("feature");
    });
  });

  describe("tags", () => {
    it("creates and lists tags", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      const oid = await client.commit("initial");

      await client.tag("v1.0.0");
      const tags = await client.listTags();
      expect(tags.length).toBe(1);
      expect(tags[0].name).toBe("v1.0.0");
      expect(tags[0].oid).toBe(oid);
    });

    it("deleteTag removes tag", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      await client.tag("v1.0.0");
      await client.deleteTag("v1.0.0");
      const tags = await client.listTags();
      expect(tags.length).toBe(0);
    });
  });

  describe("merge", () => {
    it("merges a branch", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "base");
      await client.add("file.txt");
      await client.commit("base commit");

      await client.branch("feature");
      await client.checkout("feature");
      await vfs.writeFile("/repo/feature.txt", "feature work");
      await client.add("feature.txt");
      await client.commit("feature commit");

      await client.checkout("main");
      const mergeOid = await client.merge("feature");
      expect(typeof mergeOid).toBe("string");

      const entries = await client.log();
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("remotes", () => {
    it("adds and lists remotes", async () => {
      await client.init();
      await client.addRemote("origin", "https://github.com/user/repo.git");
      const remotes = await client.listRemotes();
      expect(remotes.length).toBe(1);
      expect(remotes[0].name).toBe("origin");
      expect(remotes[0].url).toBe("https://github.com/user/repo.git");
    });

    it("deletes remote", async () => {
      await client.init();
      await client.addRemote("origin", "https://github.com/user/repo.git");
      await client.deleteRemote("origin");
      const remotes = await client.listRemotes();
      expect(remotes.length).toBe(0);
    });
  });
});
