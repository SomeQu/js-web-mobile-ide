export type { IVirtualFileSystem, FileStat, MkdirOptions } from "./types.js";
export {
  VfsError,
  FileNotFoundError,
  FileExistsError,
  NotADirectoryError,
  IsADirectoryError,
  DirectoryNotEmptyError,
} from "./errors.js";
export { MemoryFS } from "./memory-fs.js";
export {
  normalize,
  join,
  dirname,
  basename,
  isAbsolute,
  resolve,
  segments,
} from "./path-utils.js";
