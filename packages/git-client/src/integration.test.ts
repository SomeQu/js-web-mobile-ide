// packages/git-client/src/integration.test.ts

import { describe, it, expect } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createFsAdapter } from "./fs-adapter.js";
import { GitClient } from "./client.js";
import type { IGitHttpClient } from "./types.js";

const dummyHttp: IGitHttpClient = {
  request: () => Promise.reject(new Error("no network")),
};

describe("GitClient integration", () => {
  it("full local workflow: init → add → commit → branch → checkout → edit → commit → merge → log → tag → stash", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/repo", { recursive: true });
    const fs = createFsAdapter(vfs);
    const author = { name: "Dev", email: "dev@example.com" };
    const client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/repo", author });

    // Init
    await client.init();
    expect(await client.currentBranch()).toBe("main");

    // First commit
    await vfs.writeFile("/repo/index.ts", "export const version = 1;");
    await client.add("index.ts");
    const firstOid = await client.commit("initial commit");
    expect(firstOid.length).toBe(40);

    // Create and switch to feature branch
    await client.branch("feature");
    await client.checkout("feature");
    expect(await client.currentBranch()).toBe("feature");

    // Feature work
    await vfs.writeFile("/repo/feature.ts", "export function hello() { return 'hi'; }");
    await client.add("feature.ts");
    await client.commit("add feature");

    // Back to main
    await client.checkout("main");
    const mainContent = await vfs.readdir("/repo");
    expect(mainContent).not.toContain("feature.ts");

    // Diverge main so the merge below cannot fast-forward and produces a
    // real merge commit
    await vfs.writeFile("/repo/README.md", "# project");
    await client.add("README.md");
    await client.commit("add readme on main");

    // Merge feature into main (a divergent-history merge creates a merge
    // commit and updates the working directory automatically)
    const mergeOid = await client.merge("feature");
    expect(typeof mergeOid).toBe("string");
    await client.checkout("main");

    // Verify merged content
    const files = await vfs.readdir("/repo");
    expect(files).toContain("feature.ts");
    expect(files).toContain("index.ts");

    // Log shows merge history
    const log = await client.log();
    expect(log.length).toBeGreaterThanOrEqual(3);

    // Tag the release
    await client.tag("v1.0.0");
    const tags = await client.listTags();
    expect(tags[0].name).toBe("v1.0.0");

    // Branch list
    const branches = await client.listBranches();
    expect(branches.map((b) => b.name).sort()).toEqual(["feature", "main"]);

    // Stash workflow
    await vfs.writeFile("/repo/index.ts", "export const version = 2;");
    await client.add("index.ts");
    await client.stash({ message: "bump version" });

    const stashContent = await vfs.readFile("/repo/index.ts");
    expect(new TextDecoder().decode(stashContent)).toBe("export const version = 1;");

    const stashList = await client.stashList();
    expect(stashList.length).toBe(1);
    expect(stashList[0].message).toBe("bump version");

    await client.stashPop();
    const restoredContent = await vfs.readFile("/repo/index.ts");
    expect(new TextDecoder().decode(restoredContent)).toBe("export const version = 2;");

    // Status check — clean after pop and add
    await client.add("index.ts");
    await client.commit("bump version");
    const status = await client.statusAll();
    const dirty = status.filter((r) => r.head !== r.workdir || r.head !== r.stage);
    expect(dirty.length).toBe(0);

    // Cleanup branch
    await client.deleteBranch("feature");
    const finalBranches = await client.listBranches();
    expect(finalBranches.map((b) => b.name)).toEqual(["main"]);
  });
});
