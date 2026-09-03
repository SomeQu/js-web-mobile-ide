// packages/ai-assistant/src/mock-transport.test.ts

import { describe, it, expect } from "vitest";
import { MockHttpTransport } from "./mock-transport.js";

describe("MockHttpTransport", () => {
  it("returns configured response for request", async () => {
    const transport = new MockHttpTransport();
    transport.onRequest("https://api.example.com/v1/test", {
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    });

    const res = await transport.request("https://api.example.com/v1/test", {
      method: "POST",
      headers: {},
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
  });

  it("throws on unconfigured request URL", async () => {
    const transport = new MockHttpTransport();
    await expect(
      transport.request("https://unknown.com", { method: "GET", headers: {} }),
    ).rejects.toThrow("No mock configured");
  });

  it("delivers stream chunks via onChunk callback", async () => {
    const transport = new MockHttpTransport();
    transport.onStream("https://api.example.com/v1/stream", {
      chunks: ['{"type":"start"}', '{"type":"delta","text":"hi"}', '{"type":"end"}'],
    });

    const received: string[] = [];
    await transport.stream(
      "https://api.example.com/v1/stream",
      { method: "POST", headers: {}, body: "{}" },
      (chunk) => received.push(chunk),
    );

    expect(received).toEqual([
      '{"type":"start"}',
      '{"type":"delta","text":"hi"}',
      '{"type":"end"}',
    ]);
  });

  it("throws on unconfigured stream URL", async () => {
    const transport = new MockHttpTransport();
    await expect(
      transport.stream("https://unknown.com", { method: "POST", headers: {} }, () => {}),
    ).rejects.toThrow("No mock configured");
  });

  it("records all requests for assertions", async () => {
    const transport = new MockHttpTransport();
    transport.onRequest("https://api.example.com/v1/test", {
      status: 200,
      headers: {},
      body: "{}",
    });

    await transport.request("https://api.example.com/v1/test", {
      method: "POST",
      headers: { "x-key": "abc" },
      body: '{"q":"hello"}',
    });

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0].url).toBe("https://api.example.com/v1/test");
    expect(transport.requests[0].options.headers["x-key"]).toBe("abc");
    expect(transport.requests[0].options.body).toBe('{"q":"hello"}');
  });

  it("records stream requests too", async () => {
    const transport = new MockHttpTransport();
    transport.onStream("https://api.example.com/v1/stream", { chunks: [] });

    await transport.stream(
      "https://api.example.com/v1/stream",
      { method: "POST", headers: {}, body: '{"stream":true}' },
      () => {},
    );

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0].options.body).toBe('{"stream":true}');
  });
});
