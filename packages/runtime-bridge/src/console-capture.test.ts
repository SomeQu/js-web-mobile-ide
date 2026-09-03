// packages/runtime-bridge/src/console-capture.test.ts
import { describe, it, expect } from "vitest";
import { ConsoleCollector } from "./console-capture.js";

describe("ConsoleCollector", () => {
  it("pushes entries with timestamp", () => {
    const collector = new ConsoleCollector();
    const before = Date.now();
    collector.push("log", ["hello", 42]);
    const after = Date.now();

    expect(collector.entries).toHaveLength(1);
    expect(collector.entries[0].level).toBe("log");
    expect(collector.entries[0].args).toEqual(["hello", 42]);
    expect(collector.entries[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(collector.entries[0].timestamp).toBeLessThanOrEqual(after);
  });

  it("accumulates multiple entries", () => {
    const collector = new ConsoleCollector();
    collector.push("log", ["a"]);
    collector.push("warn", ["b"]);
    collector.push("error", ["c"]);
    expect(collector.entries).toHaveLength(3);
    expect(collector.entries.map((e) => e.level)).toEqual(["log", "warn", "error"]);
  });

  it("clear empties entries", () => {
    const collector = new ConsoleCollector();
    collector.push("info", ["x"]);
    collector.clear();
    expect(collector.entries).toHaveLength(0);
  });

  it("drain returns and clears", () => {
    const collector = new ConsoleCollector();
    collector.push("debug", ["one"]);
    collector.push("log", ["two"]);
    const drained = collector.drain();
    expect(drained).toHaveLength(2);
    expect(drained[0].args).toEqual(["one"]);
    expect(collector.entries).toHaveLength(0);
  });

  it("drain returns a copy", () => {
    const collector = new ConsoleCollector();
    collector.push("log", ["a"]);
    const drained = collector.drain();
    collector.push("log", ["b"]);
    expect(drained).toHaveLength(1);
  });
});
