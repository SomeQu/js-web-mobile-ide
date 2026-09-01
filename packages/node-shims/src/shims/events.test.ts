import { describe, expect, it, vi } from "vitest";
import EventEmitter from "./events.js";

describe("EventEmitter basic on/emit", () => {
  it("calls listeners registered with on", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("foo", fn);
    emitter.emit("foo", 1, 2);
    expect(fn).toHaveBeenCalledWith(1, 2);
  });

  it("emit returns true if listeners exist, false otherwise", () => {
    const emitter = new EventEmitter();
    expect(emitter.emit("foo")).toBe(false);
    emitter.on("foo", () => {});
    expect(emitter.emit("foo")).toBe(true);
  });

  it("fires multiple listeners in registration order", () => {
    const emitter = new EventEmitter();
    const order: number[] = [];
    emitter.on("foo", () => order.push(1));
    emitter.on("foo", () => order.push(2));
    emitter.on("foo", () => order.push(3));
    emitter.emit("foo");
    expect(order).toEqual([1, 2, 3]);
  });

  it("addListener is an alias for on", () => {
    const emitter = new EventEmitter();
    expect(emitter.addListener).toBe(emitter.on);
  });
});

describe("EventEmitter once", () => {
  it("fires only once", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.once("foo", fn);
    emitter.emit("foo");
    emitter.emit("foo");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("EventEmitter off/removeListener", () => {
  it("removes a specific listener", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("foo", fn);
    emitter.off("foo", fn);
    emitter.emit("foo");
    expect(fn).not.toHaveBeenCalled();
  });

  it("removeListener is an alias for off", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("foo", fn);
    emitter.removeListener("foo", fn);
    emitter.emit("foo");
    expect(fn).not.toHaveBeenCalled();
  });

  it("emits removeListener event after removing", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    const removedSpy = vi.fn();
    emitter.on("removeListener", removedSpy);
    emitter.on("foo", fn);
    emitter.off("foo", fn);
    expect(removedSpy).toHaveBeenCalledWith("foo", fn);
  });
});

describe("EventEmitter removeAllListeners", () => {
  it("clears listeners for one event", () => {
    const emitter = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on("foo", fn1);
    emitter.on("bar", fn2);
    emitter.removeAllListeners("foo");
    emitter.emit("foo");
    emitter.emit("bar");
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  it("clears listeners for all events when called without an argument", () => {
    const emitter = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on("foo", fn1);
    emitter.on("bar", fn2);
    emitter.removeAllListeners();
    emitter.emit("foo");
    emitter.emit("bar");
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });
});

describe("EventEmitter introspection", () => {
  it("listenerCount reports the array length", () => {
    const emitter = new EventEmitter();
    emitter.on("foo", () => {});
    emitter.on("foo", () => {});
    expect(emitter.listenerCount("foo")).toBe(2);
    expect(emitter.listenerCount("bar")).toBe(0);
  });

  it("listeners returns a copy of registered listeners", () => {
    const emitter = new EventEmitter();
    const fn = () => {};
    emitter.on("foo", fn);
    const list = emitter.listeners("foo");
    expect(list).toEqual([fn]);
    list.push(() => {});
    expect(emitter.listenerCount("foo")).toBe(1);
  });

  it("eventNames returns registered event keys", () => {
    const emitter = new EventEmitter();
    emitter.on("foo", () => {});
    emitter.on("bar", () => {});
    expect(emitter.eventNames().sort()).toEqual(["bar", "foo"]);
  });
});

describe("EventEmitter prepend", () => {
  it("prependListener adds to the front", () => {
    const emitter = new EventEmitter();
    const order: number[] = [];
    emitter.on("foo", () => order.push(1));
    emitter.prependListener("foo", () => order.push(2));
    emitter.emit("foo");
    expect(order).toEqual([2, 1]);
  });

  it("prependOnceListener adds to the front and fires once", () => {
    const emitter = new EventEmitter();
    const order: number[] = [];
    emitter.on("foo", () => order.push(1));
    emitter.prependOnceListener("foo", () => order.push(2));
    emitter.emit("foo");
    emitter.emit("foo");
    expect(order).toEqual([2, 1, 1]);
  });
});

describe("EventEmitter max listeners", () => {
  it("setMaxListeners / getMaxListeners round-trip", () => {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(5);
    expect(emitter.getMaxListeners()).toBe(5);
  });

  it("defaultMaxListeners is 10", () => {
    expect(EventEmitter.defaultMaxListeners).toBe(10);
  });
});

describe("EventEmitter newListener", () => {
  it("fires newListener before the listener is added", () => {
    const emitter = new EventEmitter();
    let countDuringNewListener = -1;
    emitter.on("newListener", (event: string) => {
      if (event === "foo") {
        countDuringNewListener = emitter.listenerCount("foo");
      }
    });
    emitter.on("foo", () => {});
    expect(countDuringNewListener).toBe(0);
    expect(emitter.listenerCount("foo")).toBe(1);
  });
});

describe("EventEmitter rawListeners", () => {
  it("returns wrapper functions for once listeners, distinct from the original", () => {
    const emitter = new EventEmitter();
    const fn = () => {};
    emitter.once("foo", fn);
    const raw = emitter.rawListeners("foo");
    expect(raw).toHaveLength(1);
    expect(raw[0]).not.toBe(fn);

    const normal = emitter.listeners("foo");
    expect(normal).toHaveLength(1);
  });
});

describe("EventEmitter symbol events", () => {
  it("supports symbol event names", () => {
    const emitter = new EventEmitter();
    const sym = Symbol("foo");
    const fn = vi.fn();
    emitter.on(sym, fn);
    emitter.emit(sym, "payload");
    expect(fn).toHaveBeenCalledWith("payload");
  });
});

describe("EventEmitter mutation during emit", () => {
  it("does not skip the next listener when a listener removes itself during emit", () => {
    const emitter = new EventEmitter();
    const calls: string[] = [];

    const first = () => {
      calls.push("first");
      emitter.off("foo", first);
    };
    const second = () => {
      calls.push("second");
    };
    const third = () => {
      calls.push("third");
    };

    emitter.on("foo", first);
    emitter.on("foo", second);
    emitter.on("foo", third);
    emitter.emit("foo");

    expect(calls).toEqual(["first", "second", "third"]);
  });
});

describe("EventEmitter default export", () => {
  it("default export is EventEmitter", () => {
    expect(EventEmitter).toBeTypeOf("function");
    const instance = new EventEmitter();
    expect(instance).toBeInstanceOf(EventEmitter);
  });
});
