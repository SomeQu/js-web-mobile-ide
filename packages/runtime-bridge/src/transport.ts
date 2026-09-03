// packages/runtime-bridge/src/transport.ts

export interface ITransport {
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  close(): void;
}

export class MockTransport implements ITransport {
  private _handler: ((message: string) => void) | null = null;
  private _peer: MockTransport | null = null;
  private _closed = false;
  readonly messages: string[] = [];

  static createPair(): [MockTransport, MockTransport] {
    const a = new MockTransport();
    const b = new MockTransport();
    a._peer = b;
    b._peer = a;
    return [a, b];
  }

  send(message: string): void {
    if (this._closed) {
      throw new Error("Transport is closed");
    }
    this.messages.push(message);
    const peer = this._peer;
    if (peer && peer._handler && !peer._closed) {
      const handler = peer._handler;
      Promise.resolve().then(() => handler(message));
    }
  }

  onMessage(handler: (message: string) => void): void {
    this._handler = handler;
  }

  close(): void {
    this._closed = true;
    this._handler = null;
  }
}
