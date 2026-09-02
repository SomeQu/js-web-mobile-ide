// Minimal Node-compatible `fs` shim for JavaScriptCore/WKWebView.
//
// This shim never imports from `@anthropic-ide/vfs` — cross-package imports
// must go through exported interfaces, and the fs shim itself IS one of the
// artifacts populated into the VFS as a bundler-visible file (see
// packages/node-shims/src/populate.ts), so it can't depend on the vfs
// package's types at runtime. Instead it duck-types a local `VfsLike`
// interface against `IVirtualFileSystem` and reads the live VFS instance
// from `(globalThis as any).__vfs`, which the host environment is expected
// to set before any bundled code imports "fs".

import { Buffer } from "./buffer.js";
import pathMod from "./path.js";

// ---------------------------------------------------------------------------
// VFS duck-typing
// ---------------------------------------------------------------------------

interface VfsFileStat {
  type: "file" | "directory" | "symlink";
  size: number;
  mtime: number;
}

interface VfsLike {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array | string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<VfsFileStat>;
  lstat(path: string): Promise<VfsFileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
}

function getVfs(): VfsLike {
  const vfs = (globalThis as { __vfs?: VfsLike }).__vfs;
  if (!vfs) {
    throw new Error("VFS not initialized: globalThis.__vfs is not set");
  }
  return vfs;
}

function resolvePath(p: string): string {
  return pathMod.resolve(p);
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

export interface FsError extends Error {
  code: string;
  path: string;
  syscall: string;
}

const KNOWN_CODES = ["ENOENT", "EEXIST", "EISDIR", "ENOTDIR", "ENOTEMPTY", "ELOOP", "EINVAL"];

function mapError(err: unknown, syscall: string, path: string): FsError {
  let code = "EIO";
  let message: string;

  if (err instanceof Error) {
    message = err.message;
    // The VFS's error classes already carry a `.code` field (duck-typed
    // check, since we can't import the VfsError class itself).
    const maybeCode = (err as { code?: unknown }).code;
    if (typeof maybeCode === "string" && maybeCode.length > 0) {
      code = maybeCode;
    } else {
      const match = message.match(/^([A-Z]+):/);
      if (match && KNOWN_CODES.includes(match[1])) {
        code = match[1];
      }
    }
  } else {
    message = String(err);
  }

  const error = new Error(`${syscall} ${code}: ${message}, '${path}'`) as FsError;
  error.name = "Error";
  error.code = code;
  error.path = path;
  error.syscall = syscall;
  return error;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export class Stats {
  private readonly _type: "file" | "directory" | "symlink";
  size: number;
  mtime: Date;
  mtimeMs: number;
  atime: Date;
  atimeMs: number;
  ctime: Date;
  ctimeMs: number;
  birthtime: Date;
  birthtimeMs: number;
  mode: number;
  uid = 0;
  gid = 0;

  constructor(stat: VfsFileStat) {
    this._type = stat.type;
    this.size = stat.size;
    this.mtimeMs = stat.mtime;
    this.mtime = new Date(stat.mtime);
    this.atimeMs = stat.mtime;
    this.atime = new Date(stat.mtime);
    this.ctimeMs = stat.mtime;
    this.ctime = new Date(stat.mtime);
    this.birthtimeMs = stat.mtime;
    this.birthtime = new Date(stat.mtime);
    this.mode = stat.type === "directory" ? 0o755 : 0o644;
  }

  isFile(): boolean {
    return this._type === "file";
  }
  isDirectory(): boolean {
    return this._type === "directory";
  }
  isSymbolicLink(): boolean {
    return this._type === "symlink";
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared option/callback parsing helpers
// ---------------------------------------------------------------------------

export type ErrorCallback = (err: FsError | null) => void;
export type DataCallback<T> = (err: FsError | null, data: T) => void;

interface ReadFileOptions {
  encoding?: string;
}

interface MkdirOptions {
  recursive?: boolean;
}

interface RmdirOptions {
  recursive?: boolean;
}

function isFunction(value: unknown): value is (...args: unknown[]) => void {
  return typeof value === "function";
}

// ---------------------------------------------------------------------------
// promises API
// ---------------------------------------------------------------------------

async function promisesReadFile(
  path: string,
  options?: ReadFileOptions | string,
): Promise<Buffer | string> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  let bytes: Uint8Array;
  try {
    bytes = await vfs.readFile(resolved);
  } catch (err) {
    throw mapError(err, "readFile", resolved);
  }
  const buf = Buffer.from(bytes);
  const encoding =
    typeof options === "string" ? options : options?.encoding;
  if (encoding) {
    return buf.toString(encoding);
  }
  return buf;
}

async function promisesWriteFile(
  path: string,
  data: string | Buffer | Uint8Array,
): Promise<void> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  const content =
    typeof data === "string"
      ? data
      : data instanceof Buffer
        ? data._buf
        : data;
  try {
    await vfs.writeFile(resolved, content);
  } catch (err) {
    throw mapError(err, "writeFile", resolved);
  }
}

async function promisesReaddir(path: string): Promise<string[]> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  try {
    return await vfs.readdir(resolved);
  } catch (err) {
    throw mapError(err, "readdir", resolved);
  }
}

async function promisesStat(path: string): Promise<Stats> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  try {
    const stat = await vfs.stat(resolved);
    return new Stats(stat);
  } catch (err) {
    throw mapError(err, "stat", resolved);
  }
}

async function promisesLstat(path: string): Promise<Stats> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  try {
    const stat = await vfs.lstat(resolved);
    return new Stats(stat);
  } catch (err) {
    throw mapError(err, "lstat", resolved);
  }
}

async function promisesMkdir(
  path: string,
  options?: MkdirOptions,
): Promise<void> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  try {
    await vfs.mkdir(resolved, options);
  } catch (err) {
    throw mapError(err, "mkdir", resolved);
  }
}

async function promisesRmdir(
  path: string,
  options?: RmdirOptions,
): Promise<void> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  try {
    await vfs.rmdir(resolved, options);
  } catch (err) {
    throw mapError(err, "rmdir", resolved);
  }
}

async function promisesUnlink(path: string): Promise<void> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  try {
    await vfs.unlink(resolved);
  } catch (err) {
    throw mapError(err, "unlink", resolved);
  }
}

async function promisesRename(
  oldPath: string,
  newPath: string,
): Promise<void> {
  const vfs = getVfs();
  const resolvedOld = resolvePath(oldPath);
  const resolvedNew = resolvePath(newPath);
  try {
    await vfs.rename(resolvedOld, resolvedNew);
  } catch (err) {
    throw mapError(err, "rename", resolvedOld);
  }
}

async function promisesExists(path: string): Promise<boolean> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  return vfs.exists(resolved);
}

async function promisesSymlink(
  target: string,
  path: string,
): Promise<void> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  try {
    await vfs.symlink(target, resolved);
  } catch (err) {
    throw mapError(err, "symlink", resolved);
  }
}

async function promisesReadlink(path: string): Promise<string> {
  const vfs = getVfs();
  const resolved = resolvePath(path);
  try {
    return await vfs.readlink(resolved);
  } catch (err) {
    throw mapError(err, "readlink", resolved);
  }
}

export const promises = {
  readFile: promisesReadFile,
  writeFile: promisesWriteFile,
  readdir: promisesReaddir,
  stat: promisesStat,
  lstat: promisesLstat,
  mkdir: promisesMkdir,
  rmdir: promisesRmdir,
  unlink: promisesUnlink,
  rename: promisesRename,
  exists: promisesExists,
  symlink: promisesSymlink,
  readlink: promisesReadlink,
};

// ---------------------------------------------------------------------------
// callback API
// ---------------------------------------------------------------------------

export function readFile(
  path: string,
  optionsOrCallback: ReadFileOptions | string | DataCallback<Buffer | string>,
  callback?: DataCallback<Buffer | string>,
): void {
  const cb = isFunction(optionsOrCallback)
    ? (optionsOrCallback as DataCallback<Buffer | string>)
    : (callback as DataCallback<Buffer | string>);
  const options = isFunction(optionsOrCallback)
    ? undefined
    : (optionsOrCallback as ReadFileOptions | string | undefined);

  promisesReadFile(path, options).then(
    (data) => cb(null, data),
    (err: FsError) => cb(err, undefined as unknown as Buffer),
  );
}

export function writeFile(
  path: string,
  data: string | Buffer | Uint8Array,
  callback: ErrorCallback,
): void {
  promisesWriteFile(path, data).then(
    () => callback(null),
    (err: FsError) => callback(err),
  );
}

export function readdir(
  path: string,
  callback: DataCallback<string[]>,
): void {
  promisesReaddir(path).then(
    (files) => callback(null, files),
    (err: FsError) => callback(err, undefined as unknown as string[]),
  );
}

export function stat(path: string, callback: DataCallback<Stats>): void {
  promisesStat(path).then(
    (stats) => callback(null, stats),
    (err: FsError) => callback(err, undefined as unknown as Stats),
  );
}

export function lstat(path: string, callback: DataCallback<Stats>): void {
  promisesLstat(path).then(
    (stats) => callback(null, stats),
    (err: FsError) => callback(err, undefined as unknown as Stats),
  );
}

export function mkdir(
  path: string,
  optionsOrCallback: MkdirOptions | ErrorCallback,
  callback?: ErrorCallback,
): void {
  const cb = isFunction(optionsOrCallback)
    ? (optionsOrCallback as ErrorCallback)
    : (callback as ErrorCallback);
  const options = isFunction(optionsOrCallback)
    ? undefined
    : (optionsOrCallback as MkdirOptions | undefined);

  promisesMkdir(path, options).then(
    () => cb(null),
    (err: FsError) => cb(err),
  );
}

export function rmdir(
  path: string,
  optionsOrCallback: RmdirOptions | ErrorCallback,
  callback?: ErrorCallback,
): void {
  const cb = isFunction(optionsOrCallback)
    ? (optionsOrCallback as ErrorCallback)
    : (callback as ErrorCallback);
  const options = isFunction(optionsOrCallback)
    ? undefined
    : (optionsOrCallback as RmdirOptions | undefined);

  promisesRmdir(path, options).then(
    () => cb(null),
    (err: FsError) => cb(err),
  );
}

export function unlink(path: string, callback: ErrorCallback): void {
  promisesUnlink(path).then(
    () => callback(null),
    (err: FsError) => callback(err),
  );
}

export function rename(
  oldPath: string,
  newPath: string,
  callback: ErrorCallback,
): void {
  promisesRename(oldPath, newPath).then(
    () => callback(null),
    (err: FsError) => callback(err),
  );
}

export function exists(path: string, callback: (exists: boolean) => void): void {
  // Node convention: `exists`'s callback takes only a boolean, no error —
  // any VFS failure (including "VFS not initialized") is treated as false.
  promisesExists(path).then(
    (result) => callback(result),
    () => callback(false),
  );
}

export function symlink(
  target: string,
  path: string,
  callback: ErrorCallback,
): void {
  promisesSymlink(target, path).then(
    () => callback(null),
    (err: FsError) => callback(err),
  );
}

export function readlink(
  path: string,
  callback: DataCallback<string>,
): void {
  promisesReadlink(path).then(
    (link) => callback(null, link),
    (err: FsError) => callback(err, undefined as unknown as string),
  );
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
};

// ---------------------------------------------------------------------------
// default export
// ---------------------------------------------------------------------------

interface FsModule {
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  readdir: typeof readdir;
  stat: typeof stat;
  lstat: typeof lstat;
  mkdir: typeof mkdir;
  rmdir: typeof rmdir;
  unlink: typeof unlink;
  rename: typeof rename;
  exists: typeof exists;
  symlink: typeof symlink;
  readlink: typeof readlink;
  Stats: typeof Stats;
  constants: typeof constants;
  promises: typeof promises;
}

const fs: FsModule = {
  readFile,
  writeFile,
  readdir,
  stat,
  lstat,
  mkdir,
  rmdir,
  unlink,
  rename,
  exists,
  symlink,
  readlink,
  Stats,
  constants,
  promises,
};

export default fs;
