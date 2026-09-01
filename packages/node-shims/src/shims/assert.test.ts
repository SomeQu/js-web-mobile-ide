import { describe, expect, it } from "vitest";
import assert, {
  AssertionError,
  deepEqual,
  deepStrictEqual,
  doesNotThrow,
  equal,
  fail,
  ifError,
  notDeepEqual,
  notDeepStrictEqual,
  notEqual,
  notStrictEqual,
  ok,
  strictEqual,
  throws,
} from "./assert.js";

describe("assert (the function itself)", () => {
  it("passes for truthy values", () => {
    expect(() => assert(true)).not.toThrow();
  });

  it("throws AssertionError for falsy values", () => {
    expect(() => assert(false)).toThrow(AssertionError);
  });
});

describe("assert.ok", () => {
  it("passes for truthy, throws for falsy", () => {
    expect(() => ok(1)).not.toThrow();
    expect(() => ok(0)).toThrow(AssertionError);
  });
});

describe("assert.equal / notEqual (loose)", () => {
  it("equal uses loose equality", () => {
    expect(() => equal(1, "1")).not.toThrow();
  });

  it("notEqual passes when loosely unequal", () => {
    expect(() => notEqual(1, 2)).not.toThrow();
  });
});

describe("assert.strictEqual / notStrictEqual", () => {
  it("strictEqual passes for identical values", () => {
    expect(() => strictEqual(1, 1)).not.toThrow();
  });

  it("strictEqual throws when types differ", () => {
    expect(() => strictEqual(1, "1")).toThrow(AssertionError);
  });

  it("notStrictEqual passes when strictly unequal", () => {
    expect(() => notStrictEqual(1, "1")).not.toThrow();
  });
});

describe("assert.deepEqual / deepStrictEqual", () => {
  it("deepEqual passes for equal plain objects", () => {
    expect(() => deepEqual({ a: 1 }, { a: 1 })).not.toThrow();
  });

  it("deepEqual throws for unequal plain objects", () => {
    expect(() => deepEqual({ a: 1 }, { a: 2 })).toThrow(AssertionError);
  });

  it("deepStrictEqual checks types", () => {
    expect(() => deepStrictEqual(1, "1")).toThrow(AssertionError);
  });

  it("notDeepEqual / notDeepStrictEqual pass for different values", () => {
    expect(() => notDeepEqual({ a: 1 }, { a: 2 })).not.toThrow();
    expect(() => notDeepStrictEqual(1, "1")).not.toThrow();
  });

  it("handles nested objects and arrays", () => {
    expect(() =>
      deepEqual({ a: [1, 2, { b: 3 }] }, { a: [1, 2, { b: 3 }] }),
    ).not.toThrow();
    expect(() =>
      deepEqual({ a: [1, 2, { b: 3 }] }, { a: [1, 2, { b: 4 }] }),
    ).toThrow(AssertionError);
  });

  it("handles Date", () => {
    expect(() =>
      deepEqual(new Date(2020, 0, 1), new Date(2020, 0, 1)),
    ).not.toThrow();
    expect(() =>
      deepEqual(new Date(2020, 0, 1), new Date(2020, 0, 2)),
    ).toThrow(AssertionError);
  });

  it("handles RegExp", () => {
    expect(() => deepEqual(/abc/gi, /abc/gi)).not.toThrow();
    expect(() => deepEqual(/abc/gi, /abc/g)).toThrow(AssertionError);
  });

  it("handles Map", () => {
    expect(() =>
      deepEqual(
        new Map([["a", 1]]),
        new Map([["a", 1]]),
      ),
    ).not.toThrow();
    expect(() =>
      deepEqual(
        new Map([["a", 1]]),
        new Map([["a", 2]]),
      ),
    ).toThrow(AssertionError);
  });

  it("handles Set", () => {
    expect(() => deepEqual(new Set([1, 2]), new Set([2, 1]))).not.toThrow();
    expect(() => deepEqual(new Set([1, 2]), new Set([1, 3]))).toThrow(
      AssertionError,
    );
  });

  it("throws instead of looping forever on circular references", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const b: Record<string, unknown> = { name: "a" };
    b.self = b;
    expect(() => deepEqual(a, b)).toThrow();
  });
});

describe("assert.throws", () => {
  it("passes when the function throws", () => {
    expect(() =>
      throws(() => {
        throw new Error("x");
      }),
    ).not.toThrow();
  });

  it("passes when the thrown message matches a RegExp", () => {
    expect(() =>
      throws(() => {
        throw new Error("x");
      }, /x/),
    ).not.toThrow();
  });

  it("passes when the thrown error matches a class", () => {
    expect(() =>
      throws(() => {
        throw new Error("x");
      }, Error),
    ).not.toThrow();
  });

  it("throws AssertionError if the function does not throw", () => {
    expect(() => throws(() => 1)).toThrow(AssertionError);
  });
});

describe("assert.doesNotThrow", () => {
  it("passes when the function does not throw", () => {
    expect(() => doesNotThrow(() => 1)).not.toThrow();
  });

  it("throws when the function throws", () => {
    expect(() =>
      doesNotThrow(() => {
        throw new Error("boom");
      }),
    ).toThrow(AssertionError);
  });
});

describe("assert.fail", () => {
  it("always throws with the given message", () => {
    expect(() => fail("msg")).toThrow("msg");
  });
});

describe("assert.ifError", () => {
  it("passes for null", () => {
    expect(() => ifError(null)).not.toThrow();
  });

  it("throws for an Error value", () => {
    expect(() => ifError(new Error("bad"))).toThrow();
  });
});

describe("AssertionError", () => {
  it("carries actual/expected/operator", () => {
    try {
      strictEqual(1, 2);
      throw new Error("should not reach here");
    } catch (e) {
      expect(e).toBeInstanceOf(AssertionError);
      const err = e as AssertionError;
      expect(err.actual).toBe(1);
      expect(err.expected).toBe(2);
      expect(err.operator).toBe("===");
    }
  });
});

describe("assert default export", () => {
  it("has all methods attached", () => {
    expect(assert.ok).toBe(ok);
    expect(assert.equal).toBe(equal);
    expect(assert.notEqual).toBe(notEqual);
    expect(assert.strictEqual).toBe(strictEqual);
    expect(assert.notStrictEqual).toBe(notStrictEqual);
    expect(assert.deepEqual).toBe(deepEqual);
    expect(assert.notDeepEqual).toBe(notDeepEqual);
    expect(assert.deepStrictEqual).toBe(deepStrictEqual);
    expect(assert.notDeepStrictEqual).toBe(notDeepStrictEqual);
    expect(assert.fail).toBe(fail);
    expect(assert.throws).toBe(throws);
    expect(assert.doesNotThrow).toBe(doesNotThrow);
    expect(assert.ifError).toBe(ifError);
    expect(assert.AssertionError).toBe(AssertionError);
  });
});
