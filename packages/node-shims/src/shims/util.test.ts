import { describe, expect, it } from "vitest";
import util, {
  TextDecoder,
  TextEncoder,
  callbackify,
  deprecate,
  format,
  inherits,
  inspect,
  promisify,
  types,
} from "./util.js";

describe("promisify", () => {
  it("wraps a callback-style function", async () => {
    const add = (
      a: number,
      b: number,
      cb: (err: unknown, value?: number) => void,
    ) => cb(null, a + b);
    const addAsync = promisify(add);
    await expect(addAsync(1, 2)).resolves.toBe(3);
  });

  it("rejects when the callback receives an error", async () => {
    const fail = (cb: (err: unknown) => void) => cb(new Error("boom"));
    const failAsync = promisify(fail);
    await expect(failAsync()).rejects.toThrow("boom");
  });
});

describe("callbackify", () => {
  it("wraps an async function", () =>
    new Promise<void>((done) => {
      const double = async (a: number) => a * 2;
      const doubleCb = callbackify(double);
      doubleCb(21, (err: unknown, value?: unknown) => {
        expect(err).toBeNull();
        expect(value).toBe(42);
        done();
      });
    }));

  it("calls back with the error on rejection", () =>
    new Promise<void>((done) => {
      const fail = async () => {
        throw new Error("nope");
      };
      const failCb = callbackify(fail);
      failCb((err: unknown) => {
        expect(err).toBeInstanceOf(Error);
        done();
      });
    }));
});

describe("inherits", () => {
  it("sets up the prototype chain and super_", () => {
    function Base(this: { base: boolean }) {
      this.base = true;
    }
    function Derived(this: { derived: boolean }) {
      this.derived = true;
    }
    inherits(Derived as never, Base as never);

    expect(Object.getPrototypeOf(Derived.prototype)).toBe(Base.prototype);
    expect((Derived as unknown as { super_: unknown }).super_).toBe(Base);
  });
});

describe("format", () => {
  it("substitutes %s", () => {
    expect(format("%s world", "hello")).toBe("hello world");
  });

  it("substitutes %d", () => {
    expect(format("%d", 42)).toBe("42");
  });

  it("substitutes %j", () => {
    expect(format("%j", { a: 1 })).toBe('{"a":1}');
  });

  it("handles %% as a literal percent", () => {
    expect(format("%% %s", "a")).toBe("% a");
  });

  it("appends excess args space-separated", () => {
    expect(format("hi", "there", 1)).toBe("hi there 1");
  });
});

describe("inspect", () => {
  it("returns a string containing keys and values", () => {
    const result = inspect({ a: 1 });
    expect(result).toContain("a");
    expect(result).toContain("1");
  });

  it("handles circular references without throwing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = { name: "x" };
    obj.self = obj;
    expect(() => inspect(obj)).not.toThrow();
    expect(inspect(obj)).toContain("Circular");
  });
});

describe("deprecate", () => {
  it("returns a function that behaves like the original", () => {
    const fn = (a: number, b: number) => a + b;
    const wrapped = deprecate(fn, "use something else");
    expect(wrapped(1, 2)).toBe(3);
  });
});

describe("types", () => {
  it("isDate", () => {
    expect(types.isDate(new Date())).toBe(true);
    expect(types.isDate({})).toBe(false);
  });

  it("isRegExp", () => {
    expect(types.isRegExp(/x/)).toBe(true);
  });

  it("isArray", () => {
    expect(types.isArray([])).toBe(true);
  });

  it("isString / isNumber", () => {
    expect(types.isString("x")).toBe(true);
    expect(types.isNumber(1)).toBe(true);
  });

  it("isNull / isUndefined", () => {
    expect(types.isNull(null)).toBe(true);
    expect(types.isUndefined(undefined)).toBe(true);
  });

  it("isFunction", () => {
    expect(types.isFunction(() => {})).toBe(true);
  });

  it("isBuffer checks the _isBuffer flag", () => {
    expect(types.isBuffer({ _isBuffer: true })).toBe(true);
    expect(types.isBuffer({})).toBe(false);
  });
});

describe("TextEncoder / TextDecoder", () => {
  it("re-exports the host TextEncoder", () => {
    expect(new TextEncoder().encode("hi")).toEqual(
      new Uint8Array([104, 105]),
    );
  });

  it("re-exports the host TextDecoder", () => {
    expect(new TextDecoder().decode(new Uint8Array([104, 105]))).toBe("hi");
  });
});

describe("util default export", () => {
  it("contains all named exports", () => {
    expect(util.format).toBe(format);
    expect(util.inspect).toBe(inspect);
    expect(util.promisify).toBe(promisify);
    expect(util.callbackify).toBe(callbackify);
    expect(util.inherits).toBe(inherits);
    expect(util.deprecate).toBe(deprecate);
    expect(util.types).toBe(types);
    expect(util.TextEncoder).toBe(TextEncoder);
    expect(util.TextDecoder).toBe(TextDecoder);
  });
});
