// packages/runtime-bridge/src/network-proxy.test.ts
import { describe, it, expect } from "vitest";
import { NetworkProxy } from "./network-proxy.js";
import type { NetworkHandler } from "./network-proxy.js";
import { createRequest } from "./protocol.js";

describe("NetworkProxy", () => {
  it("returns NETWORK_ERROR when handler not provided", async () => {
    const proxy = new NetworkProxy();
    const req = createRequest("fetch", { url: "https://example.com" });
    const res = await proxy.handleRequest(req);
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("NETWORK_ERROR");
    expect(res.error!.message).toBe("Network access disabled");
  });

  it("delegates to handler and returns response", async () => {
    const handler: NetworkHandler = {
      async fetch(req) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: '{"ok":true}',
        };
      },
    };
    const proxy = new NetworkProxy(handler);
    const req = createRequest("fetch", {
      url: "https://api.example.com/data",
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: '{"q":"test"}',
    });
    const res = await proxy.handleRequest(req);
    expect(res.error).toBeUndefined();
    expect((res.result as any).status).toBe(200);
    expect((res.result as any).body).toBe('{"ok":true}');
  });

  it("returns NETWORK_ERROR when handler throws", async () => {
    const handler: NetworkHandler = {
      async fetch() {
        throw new Error("DNS resolution failed");
      },
    };
    const proxy = new NetworkProxy(handler);
    const req = createRequest("fetch", { url: "https://bad.example.com" });
    const res = await proxy.handleRequest(req);
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("NETWORK_ERROR");
    expect(res.error!.message).toBe("DNS resolution failed");
  });
});
