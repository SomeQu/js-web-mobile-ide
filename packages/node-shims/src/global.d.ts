// Minimal ambient declarations for Web-standard globals available at runtime
// in JavaScriptCore/WKWebView (and in the Vitest/Node test environment), but
// not included in the "ES2020" lib (which has no DOM/WebWorker types).
//
// Scoped to this package only — see CLAUDE.md: no Node-specific APIs in
// /packages source, and the runtime target is JavaScriptCore/WKWebView,
// which provides these constructors globally.

declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  readonly encoding: string;
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

declare namespace WebAssembly {
  class Module {
    constructor(bytes: ArrayBufferLike | ArrayBufferView);
  }
}
