// packages/runtime-bridge/src/console-capture.ts
import type { ConsoleLevel, ConsoleEntry } from "./types.js";

export class ConsoleCollector {
  readonly entries: ConsoleEntry[] = [];

  push(level: ConsoleLevel, args: unknown[]): void {
    this.entries.push({
      level,
      args,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.entries.length = 0;
  }

  drain(): ConsoleEntry[] {
    const result = this.entries.slice();
    this.clear();
    return result;
  }
}
