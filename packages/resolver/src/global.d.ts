// Ambient declarations for Web-standard fetch API available at runtime
// in JavaScriptCore/WKWebView but not in the ES2020 lib.
// In the test environment (Node/Vitest), fetch is also globally available
// since Node 18+.

declare function fetch(input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}): Promise<Response>;

declare class Response {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare class Headers {
  get(name: string): string | null;
  has(name: string): boolean;
}

// Minimal ambient declarations for Web-standard globals available at runtime
// in JavaScriptCore/WKWebView (and in the Vitest/Node test environment), but
// not included in the "ES2020" lib (which has no DOM/WebWorker types).

declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  readonly encoding: string;
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}
