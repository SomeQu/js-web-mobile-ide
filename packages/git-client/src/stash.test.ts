// packages/git-client/src/stash.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createFsAdapter } from "./fs-adapter.js";
import { GitClient } from "./client.js";
import type { IGitHttpClient } from "./types.js";

const dummyHttp: IGitHttpClient = {
  request: () => Promise.reject(new Error("no network")),
};

const testAuthor = { name: "Test", email: "test@test.com" };

describe("stash", () => {
  let vfs: InstanceType<typeof MemoryFS>;
  let client: GitClient;

  beforeEach(async () => {
    vfs = new MemoryFS();
    await vfs.mkdir("/repo", { recursive: true });
    const fs = createFsAdapter(vfs);
    client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/repo", author: testAuthor });
    await client.init();
    await vfs.writeFile("/repo/base.txt", "base content");
    await client.add("base.txt");
    await client.commit("initial commit");
  });

  it("stash saves working directory changes", async () => {
    await vfs.writeFile("/repo/base.txt", "modified content");
    await client.add("base.txt");
    await client.stash({ message: "wip changes" });

    const content = await vfs.readFile("/repo/base.txt");
    const text = new TextDecoder().decode(content);
    expect(text).toBe("base content");
  });

  it("stashList returns stash entries", async () => {
    await vfs.writeFile("/repo/base.txt", "modified");
    await client.add("base.txt");
    await client.stash({ message: "first stash" });

    const list = await client.stashList();
    expect(list.length).toBe(1);
    expect(list[0].index).toBe(0);
    expect(list[0].message).toBe("first stash");
    expect(typeof list[0].oid).toBe("string");
  });

  it("stashPop restores changes", async () => {
    await vfs.writeFile("/repo/base.txt", "modified for stash");
    await client.add("base.txt");
    await client.stash({ message: "my stash" });

    await client.stashPop();

    const content = await vfs.readFile("/repo/base.txt");
    const text = new TextDecoder().decode(content);
    expect(text).toBe("modified for stash");
  });

  it("stashPop removes entry from list", async () => {
    await vfs.writeFile("/repo/base.txt", "mod");
    await client.add("base.txt");
    await client.stash({ message: "temp" });

    await client.stashPop();

    const list = await client.stashList();
    expect(list.length).toBe(0);
  });

  it("stashPop on empty stash throws", async () => {
    await expect(client.stashPop()).rejects.toThrow();
  });

  it("multiple stashes stack correctly", async () => {
    await vfs.writeFile("/repo/base.txt", "first change");
    await client.add("base.txt");
    await client.stash({ message: "first" });

    await vfs.writeFile("/repo/base.txt", "second change");
    await client.add("base.txt");
    await client.stash({ message: "second" });

    const list = await client.stashList();
    expect(list.length).toBe(2);
    expect(list[0].message).toBe("second");
    expect(list[1].message).toBe("first");
  });

  it("stash with default message", async () => {
    await vfs.writeFile("/repo/base.txt", "changed");
    await client.add("base.txt");
    await client.stash();

    const list = await client.stashList();
    expect(list[0].message).toBe("WIP");
  });

  it("stash throws when there are no changes", async () => {
    await expect(client.stash()).rejects.toThrow();
  });

  it("stash handles a newly added file", async () => {
    await vfs.writeFile("/repo/new.txt", "new file content");
    await client.add("new.txt");
    await client.stash({ message: "add new file" });

    await expect(vfs.readFile("/repo/new.txt")).rejects.toThrow();

    await client.stashPop();
    const content = await vfs.readFile("/repo/new.txt");
    expect(new TextDecoder().decode(content)).toBe("new file content");
  });
});
