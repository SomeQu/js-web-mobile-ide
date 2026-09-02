import { describe, it, expect } from "vitest";
import { createNodeShimsPlugin } from "./plugin.js";
import { NODE_BUILTINS, SHIMS_PACKAGE_PATH } from "./constants.js";

describe("createNodeShimsPlugin", () => {
  it("returns an esbuild Plugin named 'node-shims'", () => {
    const plugin = createNodeShimsPlugin();
    expect(plugin.name).toBe("node-shims");
    expect(typeof plugin.setup).toBe("function");
  });
});

describe("NODE_BUILTINS", () => {
  it("contains all 13 supported built-in module names", () => {
    expect(NODE_BUILTINS).toHaveLength(13);
    expect(NODE_BUILTINS).toEqual(
      expect.arrayContaining([
        "assert",
        "buffer",
        "crypto",
        "events",
        "fs",
        "os",
        "path",
        "process",
        "querystring",
        "stream",
        "string_decoder",
        "url",
        "util",
      ]),
    );
  });
});

describe("SHIMS_PACKAGE_PATH", () => {
  it("is the expected node_modules path", () => {
    expect(SHIMS_PACKAGE_PATH).toBe("/node_modules/@anthropic-ide/node-shims");
  });
});
