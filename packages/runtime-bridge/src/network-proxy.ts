// packages/runtime-bridge/src/network-proxy.ts
import type { Request, Response, FetchRequest, FetchResponse } from "./types.js";
import { createResponse, createErrorResponse } from "./protocol.js";

export interface NetworkHandler {
  fetch(request: FetchRequest): Promise<FetchResponse>;
}

export class NetworkProxy {
  private readonly _handler: NetworkHandler | null;

  constructor(handler?: NetworkHandler) {
    this._handler = handler || null;
  }

  async handleRequest(request: Request): Promise<Response> {
    if (!this._handler) {
      return createErrorResponse(
        request.id,
        "NETWORK_ERROR",
        "Network access disabled",
      );
    }

    const params = (request.params || {}) as Record<string, unknown>;
    const fetchReq: FetchRequest = {
      url: params.url as string,
      method: params.method as string | undefined,
      headers: params.headers as Record<string, string> | undefined,
      body: params.body as string | undefined,
    };

    try {
      const fetchRes = await this._handler.fetch(fetchReq);
      return createResponse(request.id, fetchRes);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return createErrorResponse(request.id, "NETWORK_ERROR", message);
    }
  }
}
