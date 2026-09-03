// packages/git-client/src/http.ts

import type { IGitHttpClient } from "./types.js";

interface IsomorphicGitHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}

interface IsomorphicGitHttpResponse {
  url: string;
  method: string;
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: Iterable<Uint8Array>;
}

export function createHttpAdapter(
  client: IGitHttpClient,
): { request: (config: IsomorphicGitHttpRequest) => Promise<IsomorphicGitHttpResponse> } {
  return {
    async request(config: IsomorphicGitHttpRequest): Promise<IsomorphicGitHttpResponse> {
      const response = await client.request({
        url: config.url,
        method: config.method,
        headers: config.headers,
        body: config.body,
      });

      return {
        url: response.url,
        method: response.method,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        headers: response.headers,
        body: response.body ?? [],
      };
    },
  };
}
