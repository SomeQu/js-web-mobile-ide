export class VfsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class FileNotFoundError extends VfsError {
  constructor(path: string) {
    super(`ENOENT: no such file or directory, '${path}'`, "ENOENT", path);
  }
}

export class FileExistsError extends VfsError {
  constructor(path: string) {
    super(`EEXIST: file already exists, '${path}'`, "EEXIST", path);
  }
}

export class NotADirectoryError extends VfsError {
  constructor(path: string) {
    super(`ENOTDIR: not a directory, '${path}'`, "ENOTDIR", path);
  }
}

export class IsADirectoryError extends VfsError {
  constructor(path: string) {
    super(`EISDIR: is a directory, '${path}'`, "EISDIR", path);
  }
}

export class DirectoryNotEmptyError extends VfsError {
  constructor(path: string) {
    super(`ENOTEMPTY: directory not empty, '${path}'`, "ENOTEMPTY", path);
  }
}
