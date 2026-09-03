// packages/git-client/src/errors.ts

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export class GitAuthError extends GitError {
  readonly url: string;
  constructor(url: string) {
    super(`Authentication failed for ${url}`);
    this.name = "GitAuthError";
    this.url = url;
  }
}

export class GitMergeConflictError extends GitError {
  readonly conflicts: string[];
  constructor(conflicts: string[]) {
    super(`Merge conflict in: ${conflicts.join(", ")}`);
    this.name = "GitMergeConflictError";
    this.conflicts = conflicts;
  }
}

export class GitRefNotFoundError extends GitError {
  readonly ref: string;
  constructor(ref: string) {
    super(`Ref not found: ${ref}`);
    this.name = "GitRefNotFoundError";
    this.ref = ref;
  }
}
