import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { resolveModuleSpecifier, resolvePackageExports } from "./resolver.js";

describe("resolveModuleSpecifier", () => {
  let vfs: MemoryFS;
  let cache: Map<string, unknown>;

  beforeEach(() => {
    vfs = new MemoryFS();
    cache = new Map();
  });

  describe("relative imports", () => {
    it("resolves exact file path", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/utils.ts", "export const x = 1;");

      const result = await resolveModuleSpecifier("./utils.ts", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/utils.ts");
    });

    it("resolves .ts extension", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/utils.ts", "export const x = 1;");

      const result = await resolveModuleSpecifier("./utils", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/utils.ts");
    });

    it("resolves .tsx extension", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/Button.tsx", "export default () => <div/>;");

      const result = await resolveModuleSpecifier("./Button", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/Button.tsx");
    });

    it("resolves .js extension", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/helper.js", "export const x = 1;");

      const result = await resolveModuleSpecifier("./helper", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/helper.js");
    });

    it("resolves .jsx extension", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/App.jsx", "export default () => <div/>;");

      const result = await resolveModuleSpecifier("./App", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/App.jsx");
    });

    it("resolves directory index.ts", async () => {
      await vfs.mkdir("/project/src/components", { recursive: true });
      await vfs.writeFile("/project/src/components/index.ts", "export {};");

      const result = await resolveModuleSpecifier("./components", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/components/index.ts");
    });

    it("resolves directory index.tsx", async () => {
      await vfs.mkdir("/project/src/components", { recursive: true });
      await vfs.writeFile("/project/src/components/index.tsx", "export {};");

      const result = await resolveModuleSpecifier("./components", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/components/index.tsx");
    });

    it("resolves parent directory imports", async () => {
      await vfs.mkdir("/project/src/components", { recursive: true });
      await vfs.writeFile("/project/src/utils.ts", "export const x = 1;");

      const result = await resolveModuleSpecifier("../utils", "/project/src/components/Button.tsx", vfs, cache);
      expect(result).toBe("/project/src/utils.ts");
    });

    it("throws on missing relative import", async () => {
      await vfs.mkdir("/project/src", { recursive: true });

      await expect(
        resolveModuleSpecifier("./nonexistent", "/project/src/index.ts", vfs, cache),
      ).rejects.toThrow(/Cannot resolve.*nonexistent/);
    });
  });

  describe("bare specifiers", () => {
    it("resolves package with main field", async () => {
      await vfs.mkdir("/node_modules/lodash", { recursive: true });
      await vfs.writeFile("/node_modules/lodash/package.json", JSON.stringify({
        name: "lodash",
        main: "./lodash.js",
      }));
      await vfs.writeFile("/node_modules/lodash/lodash.js", "module.exports = {};");

      const result = await resolveModuleSpecifier("lodash", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/lodash/lodash.js");
    });

    it("resolves package with module field over main", async () => {
      await vfs.mkdir("/node_modules/my-pkg", { recursive: true });
      await vfs.writeFile("/node_modules/my-pkg/package.json", JSON.stringify({
        name: "my-pkg",
        main: "./dist/index.cjs",
        module: "./dist/index.mjs",
      }));
      await vfs.writeFile("/node_modules/my-pkg/dist/index.mjs", "export default {};");
      await vfs.mkdir("/node_modules/my-pkg/dist", { recursive: true });

      const result = await resolveModuleSpecifier("my-pkg", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/my-pkg/dist/index.mjs");
    });

    it("resolves package with exports field", async () => {
      await vfs.mkdir("/node_modules/my-pkg/dist", { recursive: true });
      await vfs.writeFile("/node_modules/my-pkg/package.json", JSON.stringify({
        name: "my-pkg",
        exports: {
          ".": {
            import: "./dist/index.mjs",
            default: "./dist/index.cjs",
          },
        },
      }));
      await vfs.writeFile("/node_modules/my-pkg/dist/index.mjs", "export default {};");

      const result = await resolveModuleSpecifier("my-pkg", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/my-pkg/dist/index.mjs");
    });

    it("resolves subpath exports", async () => {
      await vfs.mkdir("/node_modules/lodash-es/dist", { recursive: true });
      await vfs.writeFile("/node_modules/lodash-es/package.json", JSON.stringify({
        name: "lodash-es",
        exports: {
          ".": "./dist/index.mjs",
          "./merge": "./dist/merge.mjs",
        },
      }));
      await vfs.writeFile("/node_modules/lodash-es/dist/merge.mjs", "export default function merge() {}");

      const result = await resolveModuleSpecifier("lodash-es/merge", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/lodash-es/dist/merge.mjs");
    });

    it("resolves scoped packages", async () => {
      await vfs.mkdir("/node_modules/@scope/pkg/dist", { recursive: true });
      await vfs.writeFile("/node_modules/@scope/pkg/package.json", JSON.stringify({
        name: "@scope/pkg",
        main: "./dist/index.js",
      }));
      await vfs.writeFile("/node_modules/@scope/pkg/dist/index.js", "export default {};");

      const result = await resolveModuleSpecifier("@scope/pkg", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/@scope/pkg/dist/index.js");
    });

    it("resolves subpath of scoped package", async () => {
      await vfs.mkdir("/node_modules/@scope/pkg/dist", { recursive: true });
      await vfs.writeFile("/node_modules/@scope/pkg/package.json", JSON.stringify({
        name: "@scope/pkg",
        exports: {
          ".": "./dist/index.js",
          "./utils": "./dist/utils.js",
        },
      }));
      await vfs.writeFile("/node_modules/@scope/pkg/dist/utils.js", "export const x = 1;");

      const result = await resolveModuleSpecifier("@scope/pkg/utils", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/@scope/pkg/dist/utils.js");
    });

    it("falls back to index.js when no main/module/exports", async () => {
      await vfs.mkdir("/node_modules/simple-pkg", { recursive: true });
      await vfs.writeFile("/node_modules/simple-pkg/package.json", JSON.stringify({
        name: "simple-pkg",
      }));
      await vfs.writeFile("/node_modules/simple-pkg/index.js", "export default {};");

      const result = await resolveModuleSpecifier("simple-pkg", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/simple-pkg/index.js");
    });

    it("throws on missing package", async () => {
      await expect(
        resolveModuleSpecifier("nonexistent-pkg", "/project/src/index.ts", vfs, cache),
      ).rejects.toThrow(/Cannot resolve.*nonexistent-pkg/);
    });

    it("caches package.json reads", async () => {
      await vfs.mkdir("/node_modules/cached-pkg", { recursive: true });
      await vfs.writeFile("/node_modules/cached-pkg/package.json", JSON.stringify({
        name: "cached-pkg",
        main: "./index.js",
      }));
      await vfs.writeFile("/node_modules/cached-pkg/index.js", "export default {};");

      await resolveModuleSpecifier("cached-pkg", "/project/src/a.ts", vfs, cache);
      await resolveModuleSpecifier("cached-pkg", "/project/src/b.ts", vfs, cache);

      expect(cache.size).toBe(1);
    });
  });

  describe("absolute paths", () => {
    it("resolves absolute path with extension probing", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/file.ts", "export const x = 1;");

      const result = await resolveModuleSpecifier("/project/src/file", "/ignored.ts", vfs, cache);
      expect(result).toBe("/project/src/file.ts");
    });
  });
});

describe("resolvePackageExports", () => {
  it("resolves string shorthand", () => {
    const result = resolvePackageExports("./dist/index.mjs", ".", ["import", "default"]);
    expect(result).toBe("./dist/index.mjs");
  });

  it("resolves subpath exports", () => {
    const exports = {
      ".": "./dist/index.mjs",
      "./merge": "./dist/merge.mjs",
    };
    expect(resolvePackageExports(exports, "./merge", ["import", "default"])).toBe("./dist/merge.mjs");
  });

  it("resolves conditional exports with priority", () => {
    const exports = {
      ".": {
        browser: "./dist/browser.mjs",
        import: "./dist/index.mjs",
        default: "./dist/index.cjs",
      },
    };
    expect(resolvePackageExports(exports, ".", ["browser", "import", "default"])).toBe("./dist/browser.mjs");
  });

  it("resolves import condition when browser absent", () => {
    const exports = {
      ".": {
        import: "./dist/index.mjs",
        default: "./dist/index.cjs",
      },
    };
    expect(resolvePackageExports(exports, ".", ["browser", "import", "default"])).toBe("./dist/index.mjs");
  });

  it("resolves subpath patterns", () => {
    const exports = {
      "./*.js": "./src/*.js",
    };
    expect(resolvePackageExports(exports, "./utils.js", ["import", "default"])).toBe("./src/utils.js");
  });

  it("resolves nested conditions", () => {
    const exports = {
      ".": {
        browser: {
          import: "./dist/browser.mjs",
          default: "./dist/browser.cjs",
        },
        import: "./dist/node.mjs",
      },
    };
    expect(resolvePackageExports(exports, ".", ["browser", "import", "default"])).toBe("./dist/browser.mjs");
  });

  it("returns null for unmatched subpath", () => {
    const exports = {
      ".": "./dist/index.mjs",
    };
    expect(resolvePackageExports(exports, "./nonexistent", ["import", "default"])).toBeNull();
  });
});
