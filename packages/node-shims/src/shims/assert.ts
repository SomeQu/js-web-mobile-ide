// Minimal Node-compatible `assert` shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained except for the one intentional
// cross-shim import of `format` from `./util.js`, used to build human
// readable assertion messages.

import { format } from "./util.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

export interface AssertionErrorOptions {
  message?: string;
  actual?: unknown;
  expected?: unknown;
  operator?: string;
}

function describe(value: unknown): string {
  return typeof value === "string" ? value : format("%o", value);
}

function generateMessage(options: AssertionErrorOptions): string {
  const { actual, expected, operator } = options;
  if (operator === "fail") {
    return "Failed";
  }
  return `${describe(actual)} ${operator ?? ""} ${describe(expected)}`.trim();
}

// Note: this is spelled "AssertionError" (not "AssertError") to match the
// Node.js API surface being shimmed.
export class AssertionError extends Error {
  actual: unknown;
  expected: unknown;
  operator: string;
  generatedMessage: boolean;

  constructor(options: AssertionErrorOptions = {}) {
    const generatedMessage = options.message === undefined;
    const message = options.message ?? generateMessage(options);
    super(message);
    this.name = "AssertionError";
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator ?? "";
    this.generatedMessage = generatedMessage;
    Object.setPrototypeOf(this, AssertionError.prototype);
  }
}

function throwAssertion(
  actual: unknown,
  expected: unknown,
  message: string | Error | undefined,
  operator: string,
): never {
  if (message instanceof Error) {
    throw message;
  }
  throw new AssertionError({
    message,
    actual,
    expected,
    operator,
  });
}

// ---------------------------------------------------------------------------
// deepEqual / deepStrictEqual
// ---------------------------------------------------------------------------

type Pair = [unknown, unknown];

function bothNonNullObjects(a: unknown, b: unknown): boolean {
  return typeof a === "object" && a !== null && typeof b === "object" && b !== null;
}

function isBufferLike(
  v: unknown,
): v is { _isBuffer: true; equals: (other: unknown) => boolean } {
  return (
    !!v &&
    typeof v === "object" &&
    (v as { _isBuffer?: boolean })._isBuffer === true &&
    typeof (v as { equals?: unknown }).equals === "function"
  );
}

function deepEqualInternal(
  a: unknown,
  b: unknown,
  strict: boolean,
  stack: Pair[],
): boolean {
  if (a === b) {
    return true;
  }

  if (!bothNonNullObjects(a, b)) {
    if (strict) {
      return false;
    }
    return a == b;
  }

  for (const [sa, sb] of stack) {
    if (sa === a && sb === b) {
      throw new Error(
        "Circular reference detected while comparing values with assert.deepEqual",
      );
    }
  }
  stack.push([a, b]);

  try {
    if (a instanceof Date || b instanceof Date) {
      if (!(a instanceof Date) || !(b instanceof Date)) {
        return false;
      }
      return a.getTime() === b.getTime();
    }

    if (a instanceof RegExp || b instanceof RegExp) {
      if (!(a instanceof RegExp) || !(b instanceof RegExp)) {
        return false;
      }
      return a.source === b.source && a.flags === b.flags;
    }

    if (isBufferLike(a) || isBufferLike(b)) {
      if (!isBufferLike(a) || !isBufferLike(b)) {
        return false;
      }
      return a.equals(b);
    }

    if (a instanceof Map || b instanceof Map) {
      if (!(a instanceof Map) || !(b instanceof Map)) {
        return false;
      }
      if (a.size !== b.size) {
        return false;
      }
      for (const [key, value] of a) {
        if (!b.has(key)) {
          return false;
        }
        if (!deepEqualInternal(value, b.get(key), strict, stack)) {
          return false;
        }
      }
      return true;
    }

    if (a instanceof Set || b instanceof Set) {
      if (!(a instanceof Set) || !(b instanceof Set)) {
        return false;
      }
      if (a.size !== b.size) {
        return false;
      }
      const bItems = Array.from(b);
      const used = new Array<boolean>(bItems.length).fill(false);
      outer: for (const item of a) {
        for (let i = 0; i < bItems.length; i++) {
          if (!used[i] && deepEqualInternal(item, bItems[i], strict, stack)) {
            used[i] = true;
            continue outer;
          }
        }
        return false;
      }
      return true;
    }

    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) {
        return false;
      }
      if (a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!deepEqualInternal(a[i], b[i], strict, stack)) {
          return false;
        }
      }
      return true;
    }

    if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
      return false;
    }

    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    const bObj = b as Record<string, unknown>;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bObj, key)) {
        return false;
      }
      if (
        !deepEqualInternal(
          (a as Record<string, unknown>)[key],
          bObj[key],
          strict,
          stack,
        )
      ) {
        return false;
      }
    }
    return true;
  } finally {
    stack.pop();
  }
}

// ---------------------------------------------------------------------------
// Assertion functions
// ---------------------------------------------------------------------------

export function ok(value: unknown, message?: string | Error): void {
  if (!value) {
    throwAssertion(value, true, message, "==");
  }
}

export function equal(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
): void {
  if (!(actual == expected)) {
    throwAssertion(actual, expected, message, "==");
  }
}

export function notEqual(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
): void {
  if (actual == expected) {
    throwAssertion(actual, expected, message, "!=");
  }
}

export function strictEqual(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
): void {
  if (!Object.is(actual, expected)) {
    throwAssertion(actual, expected, message, "===");
  }
}

export function notStrictEqual(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
): void {
  if (Object.is(actual, expected)) {
    throwAssertion(actual, expected, message, "!==");
  }
}

export function deepEqual(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
): void {
  if (!deepEqualInternal(actual, expected, false, [])) {
    throwAssertion(actual, expected, message, "deepEqual");
  }
}

export function notDeepEqual(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
): void {
  if (deepEqualInternal(actual, expected, false, [])) {
    throwAssertion(actual, expected, message, "notDeepEqual");
  }
}

export function deepStrictEqual(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
): void {
  if (!deepEqualInternal(actual, expected, true, [])) {
    throwAssertion(actual, expected, message, "deepStrictEqual");
  }
}

export function notDeepStrictEqual(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
): void {
  if (deepEqualInternal(actual, expected, true, [])) {
    throwAssertion(actual, expected, message, "notDeepStrictEqual");
  }
}

export function fail(message?: string | Error): never;
export function fail(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
  operator?: string,
): never;
export function fail(...args: unknown[]): never {
  if (args.length <= 1) {
    const message = args[0] as string | Error | undefined;
    if (message instanceof Error) {
      throw message;
    }
    throw new AssertionError({
      message: typeof message === "string" ? message : undefined,
      operator: "fail",
    });
  }
  const [actual, expected, message, operator] = args as [
    unknown,
    unknown,
    string | Error | undefined,
    string | undefined,
  ];
  throwAssertion(actual, expected, message, operator ?? "fail");
}

function matchesExpectedError(err: unknown, expected: unknown): boolean {
  if (expected instanceof RegExp) {
    const text = err instanceof Error ? err.message : String(err);
    return expected.test(text);
  }
  if (typeof expected === "function") {
    try {
      if (err instanceof (expected as AnyFn)) {
        return true;
      }
    } catch {
      // `expected` wasn't usable with `instanceof`; fall through to
      // treating it as a validator function below.
    }
    return (expected as AnyFn)(err) !== false;
  }
  if (typeof expected === "object" && expected !== null) {
    const exp = expected as Record<string, unknown>;
    return Object.keys(exp).every(
      (key) => (err as Record<string, unknown>)[key] === exp[key],
    );
  }
  return false;
}

export function throws(
  fn: () => unknown,
  error?: RegExp | AnyFn | Record<string, unknown> | string,
  message?: string,
): void {
  // `error` may be omitted, or may itself be the message when it's a plain
  // string and no separate message was given.
  let expected: RegExp | AnyFn | Record<string, unknown> | undefined;
  let msg: string | undefined;
  if (typeof error === "string" && message === undefined) {
    msg = error;
  } else {
    expected = error as RegExp | AnyFn | Record<string, unknown> | undefined;
    msg = message;
  }

  let threw = false;
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    threw = true;
    caught = e;
  }

  if (!threw) {
    throw new AssertionError({
      message: msg ?? "Missing expected exception",
      operator: "throws",
    });
  }

  if (expected !== undefined && !matchesExpectedError(caught, expected)) {
    throw caught;
  }
}

export function doesNotThrow(
  fn: () => unknown,
  message?: string,
): void {
  try {
    fn();
  } catch (e) {
    throw new AssertionError({
      message: message ?? format("Got unwanted exception: %s", e),
      actual: e,
      operator: "doesNotThrow",
    });
  }
}

export function ifError(value: unknown): void {
  if (value !== null && value !== undefined && value !== false) {
    if (value instanceof Error) {
      throw value;
    }
    throw new AssertionError({
      message: `ifError got unwanted exception: ${describe(value)}`,
      actual: value,
      expected: null,
      operator: "ifError",
    });
  }
}

export interface AssertFn {
  (value: unknown, message?: string | Error): void;
  ok: typeof ok;
  equal: typeof equal;
  notEqual: typeof notEqual;
  strictEqual: typeof strictEqual;
  notStrictEqual: typeof notStrictEqual;
  deepEqual: typeof deepEqual;
  notDeepEqual: typeof notDeepEqual;
  deepStrictEqual: typeof deepStrictEqual;
  notDeepStrictEqual: typeof notDeepStrictEqual;
  fail: typeof fail;
  throws: typeof throws;
  doesNotThrow: typeof doesNotThrow;
  ifError: typeof ifError;
  AssertionError: typeof AssertionError;
}

function assertFn(value: unknown, message?: string | Error): void {
  ok(value, message);
}

const assert = assertFn as AssertFn;
assert.ok = ok;
assert.equal = equal;
assert.notEqual = notEqual;
assert.strictEqual = strictEqual;
assert.notStrictEqual = notStrictEqual;
assert.deepEqual = deepEqual;
assert.notDeepEqual = notDeepEqual;
assert.deepStrictEqual = deepStrictEqual;
assert.notDeepStrictEqual = notDeepStrictEqual;
assert.fail = fail;
assert.throws = throws;
assert.doesNotThrow = doesNotThrow;
assert.ifError = ifError;
assert.AssertionError = AssertionError;

export default assert;
