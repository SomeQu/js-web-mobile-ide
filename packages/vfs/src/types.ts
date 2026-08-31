export interface FileStat {
  type: "file" | "directory" | "symlink";
  size: number;
  mtime: number;
}

export interface MkdirOptions {
  recursive?: boolean;
}

export interface IVirtualFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array | string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  lstat(path: string): Promise<FileStat>;
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
}
