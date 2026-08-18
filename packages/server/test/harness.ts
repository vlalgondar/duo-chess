/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import type { RoomDO } from '../src/worker.js';

export const DEFAULT_ORIGIN = 'http://localhost:5173';

const DEFAULT_EXPECT_TIMEOUT_MS = 1000;

export interface TestMessage {
  readonly t: string;
  readonly [key: string]: unknown;
}

export interface ConnectOptions {
  readonly username: string;
  readonly resumeToken?: string;
  readonly origin?: string;
}

export interface ExpectOptions {
  readonly timeout?: number;
}

export interface ExpectNeverOptions {
  readonly within: number;
}

type MessageListener = (message: TestMessage) => void;

function parseMessage(data: string | ArrayBuffer): TestMessage | null {
  const raw = typeof data === 'string' ? data : new TextDecoder().decode(data);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { t?: unknown }).t === 'string') {
      return parsed as TestMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/** A named client connected to a room, wrapping one WebSocket with message buffering and assertions. */
export class TestClient {
  readonly username: string;
  private readonly ws: WebSocket;
  private readonly received: TestMessage[] = [];
  private readonly listeners = new Set<MessageListener>();

  constructor(username: string, ws: WebSocket) {
    this.username = username;
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const message = parseMessage(event.data);
      if (!message) return;
      this.received.push(message);
      for (const listener of this.listeners) listener(message);
    });
  }

  send(message: TestMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Resolves with the next message of `type` matching `predicate`, or rejects after `timeout`ms. */
  async expect(
    type: string,
    predicate: (message: TestMessage) => boolean = () => true,
    opts: ExpectOptions = {},
  ): Promise<TestMessage> {
    const timeout = opts.timeout ?? DEFAULT_EXPECT_TIMEOUT_MS;
    const matches = (message: TestMessage) => message.t === type && predicate(message);

    const already = this.received.find(matches);
    if (already) return already;

    return new Promise<TestMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`timed out after ${timeout}ms waiting for "${type}"`));
      }, timeout);
      const listener: MessageListener = (message) => {
        if (!matches(message)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(message);
      };
      this.listeners.add(listener);
    });
  }

  /** Rejects if a message of `type` arrives within `within`ms; otherwise resolves. The leak-detection assertion. */
  async expectNever(type: string, opts: ExpectNeverOptions): Promise<void> {
    const already = this.received.find((message) => message.t === type);
    if (already) {
      throw new Error(`expected never to receive "${type}", but one already arrived`);
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, opts.within);
      const listener: MessageListener = (message) => {
        if (message.t !== type) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        reject(new Error(`expected never to receive "${type}" within ${opts.within}ms, but it arrived`));
      };
      this.listeners.add(listener);
    });
  }

  /** Drops the socket without a clean handshake, simulating a network loss. */
  disconnect(code = 1000, reason = ''): void {
    this.ws.close(code, reason);
  }
}

/** A room test double: connects clients against the real Worker + DO, plus test-only introspection. */
export class TestRoom {
  readonly code: string;
  private readonly stub: DurableObjectStub<RoomDO>;

  constructor(code: string, stub: DurableObjectStub<RoomDO>) {
    this.code = code;
    this.stub = stub;
  }

  async connect(opts: ConnectOptions): Promise<TestClient> {
    const request = new Request(`http://example.com/ws/${this.code}`, {
      headers: { Upgrade: 'websocket', Origin: opts.origin ?? DEFAULT_ORIGIN },
    });
    const response = await exports.default.fetch(request);
    const ws = response.webSocket;
    if (response.status !== 101 || !ws) {
      throw new Error(`expected a websocket upgrade for room ${this.code}, got ${response.status}`);
    }
    ws.accept();

    const client = new TestClient(opts.username, ws);
    client.send({
      t: 'join',
      username: opts.username,
      ...(opts.resumeToken ? { resumeToken: opts.resumeToken } : {}),
    });
    return client;
  }

  /** Test-only state snapshot, bypassing `redactFor()` entirely — never call this pattern outside tests. */
  async debugState(): Promise<{ socketCount: number }> {
    return runInDurableObject(this.stub, (instance) => instance.debugState());
  }

  /** Fires the room's pending alarm immediately, regardless of its deadline. Returns whether one ran. */
  async advanceTo(_deadline?: number): Promise<boolean> {
    return runDurableObjectAlarm(this.stub);
  }
}

export async function spawnRoom(opts: { code: string }): Promise<TestRoom> {
  const id = env.ROOMS.idFromName(opts.code);
  const stub = env.ROOMS.get(id);
  return new TestRoom(opts.code, stub);
}
