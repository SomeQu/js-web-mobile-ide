import type { IVirtualFileSystem } from "@anthropic-ide/vfs";

export interface InitOptions {
  wasmBinary: ArrayBuffer;
}

export interface BundleOptions {
  entryPoint: string;
  vfs: IVirtualFileSystem;
  jsx?: "transform" | "automatic";
  jsxFactory?: string;
  jsxFragment?: string;
  jsxImportSource?: string;
  minify?: boolean;
  sourceMap?: boolean;
}

export interface BundleResult {
  code: string;
  errors: BundleError[];
  warnings: BundleError[];
}

export interface BundleError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface IBundler {
  bundle(options: BundleOptions): Promise<BundleResult>;
  createContext(options: BundleOptions): Promise<BundleContext>;
}

export interface BundleContext {
  rebuild(): Promise<BundleResult>;
  dispose(): void;
}
