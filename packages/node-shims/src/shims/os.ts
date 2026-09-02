// Minimal Node-compatible `os` shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained. There is no real OS underneath this
// runtime, so every value here is a fixed, plausible stub — none of it
// reflects the actual host device.

export const EOL = "\n";
export const devNull = "/dev/null";

export interface CpuInfo {
  model: string;
  speed: number;
  times: {
    user: number;
    nice: number;
    sys: number;
    idle: number;
    irq: number;
  };
}

export interface UserInfo {
  username: string;
  uid: number;
  gid: number;
  shell: string | null;
  homedir: string;
}

export interface NetworkInterfaceInfo {
  address: string;
  netmask: string;
  family: string;
  mac: string;
  internal: boolean;
  cidr: string | null;
}

export function platform(): string {
  return "darwin";
}

export function arch(): string {
  return "arm64";
}

export function type(): string {
  return "Darwin";
}

export function release(): string {
  return "0.0.0";
}

export function version(): string {
  return "Darwin Kernel Version 23.0.0";
}

export function tmpdir(): string {
  return "/tmp";
}

export function homedir(): string {
  return "/home/user";
}

export function hostname(): string {
  return "localhost";
}

export function endianness(): "LE" | "BE" {
  return "LE";
}

export function cpus(): CpuInfo[] {
  const core: CpuInfo = {
    model: "Apple M-series",
    speed: 3200,
    times: {
      user: 0,
      nice: 0,
      sys: 0,
      idle: 0,
      irq: 0,
    },
  };
  return [core];
}

export function totalmem(): number {
  return 4 * 1024 * 1024 * 1024;
}

export function freemem(): number {
  return 2 * 1024 * 1024 * 1024;
}

export function uptime(): number {
  return 0;
}

export function loadavg(): [number, number, number] {
  return [0, 0, 0];
}

export function userInfo(): UserInfo {
  return {
    username: "user",
    uid: 501,
    gid: 20,
    shell: "/bin/zsh",
    homedir: homedir(),
  };
}

export function networkInterfaces(): Record<string, NetworkInterfaceInfo[]> {
  return {};
}

interface OsModule {
  EOL: typeof EOL;
  devNull: typeof devNull;
  platform: typeof platform;
  arch: typeof arch;
  type: typeof type;
  release: typeof release;
  version: typeof version;
  tmpdir: typeof tmpdir;
  homedir: typeof homedir;
  hostname: typeof hostname;
  endianness: typeof endianness;
  cpus: typeof cpus;
  totalmem: typeof totalmem;
  freemem: typeof freemem;
  uptime: typeof uptime;
  loadavg: typeof loadavg;
  userInfo: typeof userInfo;
  networkInterfaces: typeof networkInterfaces;
}

const os: OsModule = {
  EOL,
  devNull,
  platform,
  arch,
  type,
  release,
  version,
  tmpdir,
  homedir,
  hostname,
  endianness,
  cpus,
  totalmem,
  freemem,
  uptime,
  loadavg,
  userInfo,
  networkInterfaces,
};

export default os;
