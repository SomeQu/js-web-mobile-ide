import { describe, it, expect } from "vitest";
import { parseLockFile } from "./lockfile-parser.js";

const minimalLockV3 = JSON.stringify({
  name: "test-project",
  version: "1.0.0",
  lockfileVersion: 3,
  packages: {
    "": {
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "is-odd": "^3.0.1",
      },
    },
    "node_modules/is-number": {
      version: "6.0.0",
      resolved: "https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz",
      integrity: "sha512-fake",
    },
    "node_modules/is-odd": {
      version: "3.0.1",
      resolved: "https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz",
      integrity: "sha512-fake2",
      dependencies: {
        "is-number": "^6.0.0",
      },
    },
  },
});

const lockV2 = JSON.stringify({
  name: "v2-project",
  version: "1.0.0",
  lockfileVersion: 2,
  packages: {
    "": {
      name: "v2-project",
      version: "1.0.0",
      dependencies: { lodash: "^4.17.21" },
    },
    "node_modules/lodash": {
      version: "4.17.21",
      resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
      integrity: "sha512-abc",
    },
  },
  dependencies: {
    lodash: { version: "4.17.21", resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz" },
  },
});

describe("parseLockFile", () => {
  it("parses lockfile v3 with transitive deps", () => {
    const graph = parseLockFile(minimalLockV3);
    expect(graph.dependencies.size).toBe(2);
    expect(graph.root).toEqual(["is-odd"]);

    const isOdd = graph.dependencies.get("is-odd@3.0.1");
    expect(isOdd).toBeDefined();
    expect(isOdd!.name).toBe("is-odd");
    expect(isOdd!.version).toBe("3.0.1");
    expect(isOdd!.tarballUrl).toBe("https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz");
    expect(isOdd!.dependencies).toEqual({ "is-number": "^6.0.0" });

    const isNumber = graph.dependencies.get("is-number@6.0.0");
    expect(isNumber).toBeDefined();
    expect(isNumber!.version).toBe("6.0.0");
  });

  it("parses lockfile v2 (uses packages field)", () => {
    const graph = parseLockFile(lockV2);
    expect(graph.dependencies.size).toBe(1);
    expect(graph.root).toEqual(["lodash"]);

    const lodash = graph.dependencies.get("lodash@4.17.21");
    expect(lodash).toBeDefined();
    expect(lodash!.tarballUrl).toBe("https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz");
  });

  it("extracts package name from node_modules path", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { "@scope/pkg": "^1.0.0" } },
        "node_modules/@scope/pkg": {
          version: "1.2.3",
          resolved: "https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz",
        },
      },
    });
    const graph = parseLockFile(lock);
    expect(graph.dependencies.size).toBe(1);

    const pkg = graph.dependencies.get("@scope/pkg@1.2.3");
    expect(pkg).toBeDefined();
    expect(pkg!.name).toBe("@scope/pkg");
  });

  it("handles nested node_modules", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { a: "^1.0.0" } },
        "node_modules/a": {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz",
          dependencies: { b: "^2.0.0" },
        },
        "node_modules/a/node_modules/b": {
          version: "2.0.0",
          resolved: "https://registry.npmjs.org/b/-/b-2.0.0.tgz",
        },
      },
    });
    const graph = parseLockFile(lock);
    expect(graph.dependencies.size).toBe(2);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLockFile("not json")).toThrow();
  });

  it("throws on missing packages field", () => {
    expect(() => parseLockFile(JSON.stringify({ lockfileVersion: 3 }))).toThrow(
      "Unsupported lock file format",
    );
  });

  it("throws on lockfile v1 (no packages field)", () => {
    const v1 = JSON.stringify({
      lockfileVersion: 1,
      dependencies: { lodash: { version: "4.17.21" } },
    });
    expect(() => parseLockFile(v1)).toThrow("Unsupported lock file format");
  });

  it("skips entries without resolved URL", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { a: "^1.0.0" } },
        "node_modules/a": {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz",
        },
        "node_modules/a-linked": {
          version: "1.0.0",
          link: true,
        },
      },
    });
    const graph = parseLockFile(lock);
    expect(graph.dependencies.size).toBe(1);
  });
});
