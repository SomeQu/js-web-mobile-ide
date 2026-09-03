// packages/ai-assistant/src/conversation.ts

import { Agent } from "./agent.js";
import type {
  Message,
  AgentCallbacks,
  ToolExecutor,
  ToolDefinition,
} from "./types.js";
import type { IProvider } from "./provider.js";
import type { IHttpTransport } from "./transport.js";

export interface Conversation {
  id: string;
  messages: Message[];
  provider: string;
  model: string;
  createdAt: number;
}

interface ConversationManagerOptions {
  provider: IProvider;
  transport: IHttpTransport;
  model: string;
  system?: string;
  tools?: ToolDefinition[];
  executor: ToolExecutor;
  maxTurns?: number;
}

let idCounter = 0;
function generateId(): string {
  idCounter++;
  return "conv-" + idCounter + "-" + Math.random().toString(36).slice(2, 8);
}

export class ConversationManager {
  private _provider: IProvider;
  private _transport: IHttpTransport;
  private _model: string;
  private _system?: string;
  private _tools?: ToolDefinition[];
  private _executor: ToolExecutor;
  private _maxTurns?: number;
  private _conversations = new Map<string, Conversation>();
  private _activeAgents = new Map<string, Agent>();

  constructor(options: ConversationManagerOptions) {
    this._provider = options.provider;
    this._transport = options.transport;
    this._model = options.model;
    this._system = options.system;
    this._tools = options.tools;
    this._executor = options.executor;
    this._maxTurns = options.maxTurns;
  }

  create(): Conversation {
    const conv: Conversation = {
      id: generateId(),
      messages: [],
      provider: this._provider.name,
      model: this._model,
      createdAt: Date.now(),
    };
    this._conversations.set(conv.id, conv);
    return conv;
  }

  async send(
    conversationId: string,
    text: string,
    callbacks?: AgentCallbacks,
  ): Promise<Conversation> {
    const conv = this._conversations.get(conversationId);
    if (!conv) {
      throw new Error("Conversation not found: " + conversationId);
    }

    if (this._activeAgents.has(conversationId)) {
      throw new Error("Conversation is already running: " + conversationId);
    }

    conv.messages.push({
      role: "user",
      content: [{ type: "text", text }],
    });

    const agent = new Agent({
      provider: this._provider,
      transport: this._transport,
      model: this._model,
      system: this._system,
      tools: this._tools,
      maxTurns: this._maxTurns,
    });

    this._activeAgents.set(conversationId, agent);

    try {
      const history = await agent.run(conv.messages, this._executor, callbacks);
      conv.messages = history;
      return conv;
    } finally {
      this._activeAgents.delete(conversationId);
    }
  }

  abort(conversationId: string): void {
    const agent = this._activeAgents.get(conversationId);
    if (agent) {
      agent.abort();
    }
  }

  get(conversationId: string): Conversation | undefined {
    return this._conversations.get(conversationId);
  }

  list(): Conversation[] {
    return Array.from(this._conversations.values());
  }

  delete(conversationId: string): void {
    this._activeAgents.get(conversationId)?.abort();
    this._activeAgents.delete(conversationId);
    this._conversations.delete(conversationId);
  }
}
