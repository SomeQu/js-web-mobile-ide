import { describe, it, expect, vi } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import type { IRegistryClient } from "@anthropic-ide/registry-client";
import { createResolver } from "./installer.js";
import type { DependencyGraph, InstallProgress } from "./types.js";

function createMockClient(): IRegistryClient {
  return {
    getPackageMetadata: vi.fn(),
    downloadAndExtract: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestGraph(): DependencyGraph {
  const dependencies = new Map();
  dependencies.set("is-odd@3.0.1", {
    name: "is-odd",
    version: "3.0.1",
    tarballUrl: "https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz",
    integrity: "sha512-fake",
    dependencies: { "is-number": "^6.0.0" },
  });
  dependencies.set("is-number@6.0.0", {
    name: "is-number",
    version: "6.0.0",
    tarballUrl: "https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz",
    integrity: "sha512-fake2",
  });
  return { dependencies, root: ["is-odd"] };
}

describe("createResolver", () => {
  it("returns an object with parseLockFile and install", () => {
    const resolver = createResolver();
    expect(typeof resolver.parseLockFile).toBe("function");
    expect(typeof resolver.install).toBe("function");
  });
});

describe("install", () => {
  it("downloads all packages in the graph", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    const graph = createTestGraph();
    const resolver = createResolver();

    await resolver.install(graph, vfs, client);

    expect(client.downloadAndExtract).toHaveBeenCalledTimes(2);
    expect(client.downloadAndExtract).toHaveBeenCalledWith(
      "https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz",
      vfs,
      "/node_modules/is-odd",
    );
    expect(client.downloadAndExtract).toHaveBeenCalledWith(
      "https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz",
      vfs,
      "/node_modules/is-number",
    );
  });

  it("skips already-cached packages", async () => {
    const vfs = new MemoryFS();
    // Pre-populate one package in VFS
    await vfs.mkdir("/node_modules/is-number", { recursive: true });
    await vfs.writeFile("/node_modules/is-number/package.json", '{"name":"is-number"}');

    const client = createMockClient();
    const graph = createTestGraph();
    const resolver = createResolver();

    await resolver.install(graph, vfs, client);

    expect(client.downloadAndExtract).toHaveBeenCalledTimes(1);
    expect(client.downloadAndExtract).toHaveBeenCalledWith(
      "https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz",
      vfs,
      "/node_modules/is-odd",
    );
  });

  it("reports progress via callback", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    const graph = createTestGraph();
    const resolver = createResolver();
    const progress: InstallProgress[] = [];

    await resolver.install(graph, vfs, client, (p) => progress.push({ ...p }));

    expect(progress.length).toBe(2);
    expect(progress[0].total).toBe(2);
    expect(progress[0].downloaded).toBe(1);
    expect(progress[1].downloaded).toBe(2);
    expect(progress[1].total).toBe(2);
  });

  it("works with empty graph", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    const graph: DependencyGraph = { dependencies: new Map(), root: [] };
    const resolver = createResolver();

    await resolver.install(graph, vfs, client);

    expect(client.downloadAndExtract).not.toHaveBeenCalled();
  });

  it("handles scoped packages", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    const dependencies = new Map();
    dependencies.set("@scope/pkg@1.0.0", {
      name: "@scope/pkg",
      version: "1.0.0",
      tarballUrl: "https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz",
    });
    const graph: DependencyGraph = { dependencies, root: ["@scope/pkg"] };
    const resolver = createResolver();

    await resolver.install(graph, vfs, client);

    expect(client.downloadAndExtract).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz",
      vfs,
      "/node_modules/@scope/pkg",
    );
  });

  it("propagates download errors", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    (client.downloadAndExtract as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Download failed"),
    );
    const graph = createTestGraph();
    const resolver = createResolver();

    await expect(resolver.install(graph, vfs, client)).rejects.toThrow("Download failed");
  });
});
