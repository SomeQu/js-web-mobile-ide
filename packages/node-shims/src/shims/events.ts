// Minimal Node-compatible EventEmitter shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;
type EventKey = string | symbol;

// `console` is provided by the JavaScriptCore/WKWebView host at runtime, but
// the ES2020 lib (no DOM) doesn't declare it — add a minimal ambient shape.
declare const console: { warn: (...args: unknown[]) => void };

const ONCE_WRAPPER = Symbol("onceWrapper");

interface OnceWrapper extends Listener {
  [ONCE_WRAPPER]?: Listener;
}

export class EventEmitter {
  static defaultMaxListeners = 10;

  // Assigned to the same function reference as `on`/`off` after the class
  // body below, so `emitter.addListener === emitter.on` (Node parity).
  declare addListener: EventEmitter["on"];
  declare removeListener: EventEmitter["off"];

  private _events: Map<EventKey, Listener[]> = new Map();
  private _maxListeners: number = EventEmitter.defaultMaxListeners;

  on(event: EventKey, listener: Listener): this {
    this.emit("newListener", event, listener);

    const list = this._events.get(event);
    if (list) {
      list.push(listener);
    } else {
      this._events.set(event, [listener]);
    }

    const max = this.getMaxListeners();
    const count = this._events.get(event)!.length;
    if (max > 0 && count > max) {
      console.warn(
        `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. ` +
          `${count} ${String(event)} listeners added. Use emitter.setMaxListeners() to increase limit.`,
      );
    }

    return this;
  }

  once(event: EventKey, listener: Listener): this {
    const wrapper: OnceWrapper = (...args: unknown[]) => {
      this.off(event, wrapper);
      listener(...args);
    };
    wrapper[ONCE_WRAPPER] = listener;
    return this.on(event, wrapper);
  }

  prependListener(event: EventKey, listener: Listener): this {
    this.emit("newListener", event, listener);
    const list = this._events.get(event);
    if (list) {
      list.unshift(listener);
    } else {
      this._events.set(event, [listener]);
    }
    return this;
  }

  prependOnceListener(event: EventKey, listener: Listener): this {
    const wrapper: OnceWrapper = (...args: unknown[]) => {
      this.off(event, wrapper);
      listener(...args);
    };
    wrapper[ONCE_WRAPPER] = listener;
    return this.prependListener(event, wrapper);
  }

  off(event: EventKey, listener: Listener): this {
    const list = this._events.get(event);
    if (!list) {
      return this;
    }

    const index = list.findIndex((l) => l === listener || (l as OnceWrapper)[ONCE_WRAPPER] === listener);
    if (index !== -1) {
      list.splice(index, 1);
      if (list.length === 0) {
        this._events.delete(event);
      }
      this.emit("removeListener", event, listener);
    }

    return this;
  }

  removeAllListeners(event?: EventKey): this {
    if (event === undefined) {
      this._events.clear();
    } else {
      this._events.delete(event);
    }
    return this;
  }

  emit(event: EventKey, ...args: unknown[]): boolean {
    const list = this._events.get(event);
    if (!list || list.length === 0) {
      return false;
    }

    // Iterate a copy so removing a listener during emit doesn't skip the next one.
    const snapshot = list.slice();
    for (const listener of snapshot) {
      listener(...args);
    }
    return true;
  }

  listenerCount(event: EventKey): number {
    return this._events.get(event)?.length ?? 0;
  }

  listeners(event: EventKey): Listener[] {
    const list = this._events.get(event) ?? [];
    return list.map((l) => (l as OnceWrapper)[ONCE_WRAPPER] ?? l);
  }

  rawListeners(event: EventKey): Listener[] {
    const list = this._events.get(event) ?? [];
    return list.slice();
  }

  eventNames(): EventKey[] {
    return Array.from(this._events.keys());
  }

  setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this._maxListeners;
  }
}

EventEmitter.prototype.addListener = EventEmitter.prototype.on;
EventEmitter.prototype.removeListener = EventEmitter.prototype.off;

export default EventEmitter;
