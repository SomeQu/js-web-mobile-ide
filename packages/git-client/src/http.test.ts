// packages/git-client/src/http.test.ts

import { describe, it, expect, vi } from "vitest";
import { createHttpAdapter } from "./http.js";
import type { IGitHttpClient } from "./types.js";

function mockClient(response: {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}): IGitHttpClient {
  return {
    request: vi.fn().mockResolvedValue({
      url: "https://example.com/repo.git/info/refs",
      method: "GET",
      ...response,
    }),
  };
}

describe("createHttpAdapter", () => {
  it("returns object with request method", () => {
    const client = mockClient({ statusCode: 200, statusMessage: "OK", headers: {} });
    const adapter = createHttpAdapter(client);
    expect(adapter).toHaveProperty("request");
    expect(typeof adapter.request).toBe("function");
  });

  it("maps isomorphic-git request to IGitHttpClient.request", async () => {
    const client = mockClient({
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": "application/x-git-upload-pack-advertisement" },
      body: [new Uint8Array([1, 2, 3])],
    });
    const adapter = createHttpAdapter(client);

    const result = await adapter.request({
      url: "https://example.com/repo.git/info/refs?service=git-upload-pack",
      method: "GET",
      headers: { "accept": "application/x-git-upload-pack-advertisement" },
    });

    expect(client.request).toHaveBeenCalledWith({
      url: "https://example.com/repo.git/info/refs?service=git-upload-pack",
      method: "GET",
      headers: { "accept": "application/x-git-upload-pack-advertisement" },
      body: undefined,
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({ "content-type": "application/x-git-upload-pack-advertisement" });
  });

  it("passes body as Uint8Array array", async () => {
    const client = mockClient({
      statusCode: 200,
      statusMessage: "OK",
      headers: {},
      body: [new Uint8Array([10, 20])],
    });
    const adapter = createHttpAdapter(client);

    const bodyChunk = new Uint8Array([5, 6, 7]);
    await adapter.request({
      url: "https://example.com/repo.git/git-upload-pack",
      method: "POST",
      headers: { "content-type": "application/x-git-upload-pack-request" },
      body: [bodyChunk],
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ body: [bodyChunk] }),
    );
  });

  it("returns body as iterable of Uint8Array", async () => {
    const chunk1 = new Uint8Array([1, 2]);
    const chunk2 = new Uint8Array([3, 4]);
    const client = mockClient({
      statusCode: 200,
      statusMessage: "OK",
      headers: {},
      body: [chunk1, chunk2],
    });
    const adapter = createHttpAdapter(client);

    const result = await adapter.request({
      url: "https://example.com/repo.git/info/refs",
      method: "GET",
      headers: {},
    });

    const chunks: Uint8Array[] = [];
    for (const chunk of result.body) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([chunk1, chunk2]);
  });

  it("handles empty body response", async () => {
    const client = mockClient({
      statusCode: 204,
      statusMessage: "No Content",
      headers: {},
    });
    const adapter = createHttpAdapter(client);

    const result = await adapter.request({
      url: "https://example.com/repo.git/info/refs",
      method: "GET",
      headers: {},
    });

    expect(result.statusCode).toBe(204);
    const chunks: Uint8Array[] = [];
    for (const chunk of result.body) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([]);
  });
});
