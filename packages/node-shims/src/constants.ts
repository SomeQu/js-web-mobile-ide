export const NODE_BUILTINS = [
  "assert",
  "buffer",
  "events",
  "os",
  "path",
  "process",
  "querystring",
  "string_decoder",
  "url",
  "util",
] as const;

export type NodeBuiltin = (typeof NODE_BUILTINS)[number];

export const SHIMS_PACKAGE_PATH = "/node_modules/@anthropic-ide/node-shims";
