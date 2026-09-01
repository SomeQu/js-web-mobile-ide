// Minimal Node-compatible `process` shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained.

// `performance` and `console` are provided by the JavaScriptCore/WKWebView
// host at runtime (and by Node/vitest in tests), but the ES2020 lib (no DOM)
// doesn't declare them — add minimal ambient shapes local to this module.
declare const performance: { now(): number };
declare const console: {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export const env: Record<string, string | undefined> = {};

let _cwd = "/";

export function cwd(): string {
  return _cwd;
}

export function chdir(dir: string): void {
  _cwd = dir;
}

export function nextTick(
  fn: (...args: unknown[]) => void,
  ...args: unknown[]
): void {
  queueMicrotask(() => fn(...args));
}

export const platform = "browser";
export const version = "v20.0.0";
export const versions: Record<string, string> = { node: "20.0.0" };
export const pid = 1;
export const browser = true;
export const title = "browser";
export const argv: string[] = ["node", "shim"];

export const stdout = {
  write(chunk: string): boolean {
    console.log(chunk);
    return true;
  },
};

export const stderr = {
  write(chunk: string): boolean {
    console.error(chunk);
    return true;
  },
};

function hrtimeFn(prev?: [number, number]): [number, number] {
  const ms = performance.now();
  let seconds = Math.floor(ms / 1000);
  let nanos = Math.floor((ms % 1000) * 1e6);

  if (prev) {
    seconds -= prev[0];
    nanos -= prev[1];
    if (nanos < 0) {
      seconds -= 1;
      nanos += 1e9;
    }
  }

  return [seconds, nanos];
}

interface HRTimeFn {
  (prev?: [number, number]): [number, number];
  bigint(): bigint;
}

const hrtime = hrtimeFn as HRTimeFn;
hrtime.bigint = (): bigint => BigInt(Math.floor(performance.now() * 1e6));

export { hrtime };

export function exit(code?: number): never {
  throw new Error(`process.exit(${code ?? 0}) called`);
}

interface ProcessModule {
  env: typeof env;
  cwd: typeof cwd;
  chdir: typeof chdir;
  nextTick: typeof nextTick;
  platform: typeof platform;
  version: typeof version;
  versions: typeof versions;
  pid: typeof pid;
  browser: typeof browser;
  title: typeof title;
  argv: typeof argv;
  stdout: typeof stdout;
  stderr: typeof stderr;
  hrtime: typeof hrtime;
  exit: typeof exit;
}

const process: ProcessModule = {
  env,
  cwd,
  chdir,
  nextTick,
  platform,
  version,
  versions,
  pid,
  browser,
  title,
  argv,
  stdout,
  stderr,
  hrtime,
  exit,
};

export default process;
