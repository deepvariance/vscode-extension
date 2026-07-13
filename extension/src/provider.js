import * as vscode from 'vscode';

import { normalizeGateway } from '../../src/gateway.js';
import { CONTEXT_WINDOW, MAX_OUTPUT_TOKENS, MODEL_ID, MODEL_NAME } from './constants.js';

const ROLE_USER = vscode.LanguageModelChatMessageRole.User;

/** VS Code hands us its own part classes; map them onto the OpenAI chat-completions wire format. */
export function toOpenAIMessages(messages) {
  const out = [];

  for (const message of messages) {
    const parts = message.content ?? [];
    const text = [];
    const content = [];
    const toolCalls = [];

    for (const part of parts) {
      if (part instanceof vscode.LanguageModelTextPart) {
        text.push(part.value);
        content.push({ type: 'text', text: part.value });
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        // A tool result is its own message on the wire, and must precede the next user turn.
        out.push({ role: 'tool', tool_call_id: part.callId, content: flattenToolResult(part.content) });
      } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType?.startsWith('image/')) {
        const base64 = Buffer.from(part.data).toString('base64');
        content.push({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${base64}` } });
      }
    }

    if (message.role === ROLE_USER) {
      // Send the array form only when there is an image; plain text keeps the payload simple.
      const hasImage = content.some((c) => c.type === 'image_url');
      if (hasImage) out.push({ role: 'user', content });
      else if (text.length) out.push({ role: 'user', content: text.join('') });
    } else if (toolCalls.length || text.length) {
      const assistant = { role: 'assistant' };
      if (text.length) assistant.content = text.join('');
      if (toolCalls.length) assistant.tool_calls = toolCalls;
      out.push(assistant);
    }
  }

  return out;
}

function flattenToolResult(parts) {
  return (parts ?? [])
    .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : typeof part === 'string' ? part : JSON.stringify(part)))
    .join('\n');
}

export function toOpenAITools(tools) {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  }));
}

/** Yields each `data:` payload from an OpenAI SSE stream. */
async function* streamEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep the partial line for the next chunk

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;

      try {
        yield JSON.parse(payload);
      } catch {
        // A malformed chunk is not worth killing the whole response over.
      }
    }
  }
}

export class DeepVarianceProvider {
  constructor(context) {
    this.context = context;
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeLanguageModelChatInformation = this._onDidChange.event;
  }

  /** Call after the key changes so VS Code re-asks what models we have. */
  refresh() {
    this._onDidChange.fire();
  }

  async apiKey() {
    return this.context.secrets.get('deepvariance.apiKey');
  }

  gateway() {
    return normalizeGateway(this.context.globalState.get('deepvariance.gateway') ?? 'https://demo.deepvariance.com');
  }

  async provideLanguageModelChatInformation(_options, _token) {
    // No key yet means no model — the setup command (or the CLI handoff) supplies it.
    if (!(await this.apiKey())) return [];

    return [
      {
        id: MODEL_ID,
        name: MODEL_NAME,
        family: 'qwen',
        version: '1.0.0',
        maxInputTokens: CONTEXT_WINDOW - MAX_OUTPUT_TOKENS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        capabilities: { toolCalling: true, imageInput: true },
      },
    ];
  }

  async provideLanguageModelChatResponse(model, messages, options, progress, token) {
    const apiKey = await this.apiKey();
    if (!apiKey) throw new Error('No API key. Run "Deep Variance: Set Up" or `npx deepvariance-vscode`.');

    const controller = new AbortController();
    const cancel = token.onCancellationRequested(() => controller.abort());

    try {
      const response = await fetch(`${this.gateway()}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-User-Email': this.context.globalState.get('deepvariance.email') ?? '',
        },
        body: JSON.stringify({
          model: model.id,
          messages: toOpenAIMessages(messages),
          tools: toOpenAITools(options.tools),
          tool_choice: options.tools?.length
            ? options.toolMode === vscode.LanguageModelChatToolMode.Required
              ? 'required'
              : 'auto'
            : undefined,
          max_tokens: model.maxOutputTokens,
          stream: true,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        if (response.status === 401) {
          throw new Error(`The gateway rejected your API key (401). Re-run \`npx deepvariance-vscode\` to get a new one. ${detail}`);
        }
        throw new Error(`The gateway returned HTTP ${response.status}. ${detail}`);
      }

      // Tool calls arrive as fragments spread across chunks, keyed by index.
      const toolCalls = new Map();

      for await (const event of streamEvents(response.body)) {
        const delta = event.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) progress.report(new vscode.LanguageModelTextPart(delta.content));

        for (const call of delta.tool_calls ?? []) {
          const existing = toolCalls.get(call.index) ?? { id: '', name: '', args: '' };
          toolCalls.set(call.index, {
            id: call.id ?? existing.id,
            name: call.function?.name ?? existing.name,
            args: existing.args + (call.function?.arguments ?? ''),
          });
        }
      }

      for (const call of toolCalls.values()) {
        if (!call.name) continue;
        progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, safeParse(call.args)));
      }
    } finally {
      cancel.dispose();
    }
  }

  // ponytail: ~4 chars per token is close enough for a context-window guard. Swap in a real
  // tokenizer only if truncation actually misbehaves.
  async provideTokenCount(_model, text) {
    const value = typeof text === 'string' ? text : (text.content ?? []).map((p) => p.value ?? '').join('');
    return Math.ceil(value.length / 4);
  }
}

function safeParse(args) {
  try {
    return JSON.parse(args || '{}');
  } catch {
    return {};
  }
}
