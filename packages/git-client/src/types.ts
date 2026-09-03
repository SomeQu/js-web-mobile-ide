// packages/git-client/src/types.ts

export interface GitAuth {
  username?: string;
  password?: string;
}

export type OnAuth = (url: string) => GitAuth | Promise<GitAuth>;

export interface GitAuthor {
  name: string;
  email: string;
}

export interface GitCommit {
  oid: string;
  message: string;
  author: GitAuthor & { timestamp: number };
  parent: string[];
}

export interface GitLogEntry {
  oid: string;
  commit: GitCommit;
}

export interface GitStatusRow {
  filepath: string;
  head: 0 | 1;
  workdir: 0 | 1 | 2;
  stage: 0 | 1 | 2 | 3;
}

export interface GitBranch {
  name: string;
  current: boolean;
  oid: string;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitTag {
  name: string;
  oid: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
  oid: string;
}

export interface GitProgress {
  phase: string;
  loaded: number;
  total: number;
}

export type OnProgress = (progress: GitProgress) => void;

export interface GitHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}

export interface GitHttpResponse {
  url: string;
  method: string;
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}

export interface IGitHttpClient {
  request(config: GitHttpRequest): Promise<GitHttpResponse>;
}

export interface FsAdapterStats {
  type: string;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface FsAdapter {
  readFile(filepath: string, opts?: { encoding?: string }): Promise<Uint8Array | string>;
  writeFile(filepath: string, data: Uint8Array | string): Promise<void>;
  unlink(filepath: string): Promise<void>;
  readdir(filepath: string): Promise<string[]>;
  mkdir(filepath: string, opts?: { mode?: number }): Promise<void>;
  rmdir(filepath: string): Promise<void>;
  stat(filepath: string): Promise<FsAdapterStats>;
  lstat(filepath: string): Promise<FsAdapterStats>;
  rename(oldPath: string, newPath: string): Promise<void>;
  readlink(filepath: string): Promise<string>;
  symlink(target: string, filepath: string): Promise<void>;
}

export interface VfsLike {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array | string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ type: "file" | "directory" | "symlink"; size: number; mtime: number }>;
  lstat(path: string): Promise<{ type: "file" | "directory" | "symlink"; size: number; mtime: number }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
}

export interface GitClientOptions {
  fs: FsAdapter;
  http: IGitHttpClient;
  dir: string;
  onAuth?: OnAuth;
  author?: GitAuthor;
}
