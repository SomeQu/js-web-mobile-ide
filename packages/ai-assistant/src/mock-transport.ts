// packages/ai-assistant/src/mock-transport.ts

import type { HttpResponse, IHttpTransport } from "./transport.js";

export interface MockStreamConfig {
  chunks: string[];
  delayMs?: number;
}

interface RequestRecord {
  url: string;
  options: { method: string; headers: Record<string, string>; body?: string };
}

export class MockHttpTransport implements IHttpTransport {
  private _responses = new Map<string, HttpResponse>();
  private _streams = new Map<string, MockStreamConfig>();
  private _requests: RequestRecord[] = [];

  get requests(): ReadonlyArray<RequestRecord> {
    return this._requests;
  }

  onRequest(url: string, response: HttpResponse): void {
    this._responses.set(url, response);
  }

  onStream(url: string, config: MockStreamConfig): void {
    this._streams.set(url, config);
  }

  async request(
    url: string,
    options: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<HttpResponse> {
    this._requests.push({ url, options });
    const response = this._responses.get(url);
    if (!response) {
      throw new Error(`No mock configured for request URL: ${url}`);
    }
    return response;
  }

  async stream(
    url: string,
    options: { method: string; headers: Record<string, string>; body?: string },
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    this._requests.push({ url, options });
    const config = this._streams.get(url);
    if (!config) {
      throw new Error(`No mock configured for stream URL: ${url}`);
    }
    for (const chunk of config.chunks) {
      if (config.delayMs) {
        await new Promise((r) => setTimeout(r, config.delayMs));
      }
      onChunk(chunk);
    }
  }
}
