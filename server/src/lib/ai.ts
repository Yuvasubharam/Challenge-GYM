// Workers AI client for the member coach: tries each model in order until one returns usable JSON.
// All three speak the OpenAI chat format on Workers AI (choices[0].message.content).
import type { Env } from '../env';

export const AI_MODELS = [
  '@cf/qwen/qwen3-30b-a3b-fp8',          // primary: best planner, JSON mode, 32k context
  '@cf/ibm-granite/granite-4.0-h-micro', // second: fast + cheap, 131k context
  '@cf/zai-org/glm-5.3-flash',           // third: needs the Workers Paid plan (fails fast on Free)
] as const;

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface ChatResult { choices?: { message?: { content?: string | null } }[]; response?: unknown }

/** Pull the first JSON object out of a model reply (drops <think> blocks and ``` fences). */
export function extractJson(text: string): unknown {
  const s = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no JSON object in reply');
  // Walk to the matching brace (strings may contain braces).
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error('unterminated JSON in reply');
}

function replyText(r: ChatResult): string | unknown {
  const content = r.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  return r.response; // older Workers AI shape: string, or an already-parsed object in JSON mode
}

/**
 * Ask the model chain for a JSON answer. `validate` turns the parsed JSON into the result
 * (throw to reject it and fall through to the next model).
 */
export async function askJson<T>(env: Env, messages: ChatMessage[], validate: (json: unknown) => T, maxTokens = 4000): Promise<{ result: T; model: string }> {
  if (!env.AI) throw new Error('AI binding missing');
  const errors: string[] = [];
  for (const model of AI_MODELS) {
    const input: Record<string, unknown> = { messages, max_tokens: maxTokens, temperature: 0.4 };
    if (model.includes('qwen3')) {
      input.response_format = { type: 'json_object' };
      // Qwen3 soft switch: skip the long hidden reasoning pass (plans are selection work, not maths).
      input.messages = messages.map((m, i) => (i === messages.length - 1 ? { ...m, content: `${m.content}\n/no_think` } : m));
    }
    if (model.includes('glm')) input.reasoning_effort = 'low';
    try {
      const raw = replyText(await env.AI.run(model, input) as ChatResult);
      const json = typeof raw === 'string' ? extractJson(raw) : raw;
      if (!json || typeof json !== 'object') throw new Error('empty reply');
      return { result: validate(json), model };
    } catch (e) {
      errors.push(`${model}: ${(e as Error).message}`.slice(0, 300));
    }
  }
  console.error('coach AI: every model failed', errors);
  throw new Error(errors.join(' | '));
}
