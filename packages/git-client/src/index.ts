// packages/git-client/src/index.ts

export type {
  GitAuth,
  OnAuth,
  GitAuthor,
  GitCommit,
  GitLogEntry,
  GitStatusRow,
  GitBranch,
  GitRemote,
  GitTag,
  GitStashEntry,
  GitProgress,
  OnProgress,
  GitHttpRequest,
  GitHttpResponse,
  IGitHttpClient,
  FsAdapter,
  FsAdapterStats,
  VfsLike,
  GitClientOptions,
} from "./types.js";

export {
  GitError,
  GitAuthError,
  GitMergeConflictError,
  GitRefNotFoundError,
} from "./errors.js";
