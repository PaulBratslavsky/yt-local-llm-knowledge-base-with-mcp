import { describe, expect, it, vi } from 'vitest';
import aiToolsFactory, { AI_TOOLS_META } from './ai-tools';
import { buildToolActionDefs } from '../mcp-official/permissions';
import { listTagsTool } from '../mcp/tools/tags';

const service = aiToolsFactory({ strapi: {} as never });

describe('ai-tools (tanstack-ai contract)', () => {
  it('returns a plain array, synchronously', () => {
    const tools = service.getTools();
    expect(Array.isArray(tools)).toBe(true);
    expect((tools as unknown as { then?: unknown }).then).toBeUndefined();
    expect(tools).toHaveLength(21);
  });

  it('gives every tool the fields tanstack-ai keeps a tool for', () => {
    for (const t of service.getTools()) {
      expect(typeof t.name).toBe('string');
      expect(t.name).toMatch(/^[a-z][A-Za-z]+$/);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.schema).toBeTruthy();
      expect(typeof t.execute).toBe('function');
    }
  });

  it('declares only actions the plugin registers', () => {
    const registered = new Set(buildToolActionDefs().map((d) => `plugin::${d.pluginName}.${d.uid}`));
    for (const t of service.getTools()) expect(registered.has(t.action)).toBe(true);
    expect(service.getTools().find((t) => t.name === 'fetchTranscript')!.action).toBe('plugin::yt-kb.tool.fetch-transcript');
  });

  it('exposes a Standard JSON Schema converter on every schema', () => {
    for (const t of service.getTools()) {
      const std = (t.schema as any)['~standard'];
      expect(typeof std?.jsonSchema?.input).toBe('function');
      expect(() => std.jsonSchema.input({ target: 'draft-07' })).not.toThrow();
    }
  });

  it('calls the body with { strapi } and {} for missing args', async () => {
    const spy = vi.spyOn(listTagsTool, 'execute').mockResolvedValue({ ok: true } as never);
    const fake = { marker: 1 } as never;
    const t = service.getTools().find((x) => x.name === 'listTags')!;
    await expect(t.execute(undefined, fake, {})).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith({}, { strapi: fake });
    spy.mockRestore();
  });

  it('describes the source', () => {
    expect(service.getMeta()).toEqual(AI_TOOLS_META);
    expect(AI_TOOLS_META).toEqual({
      label: 'YT Knowledge Base',
      description: 'Search, read and add to the YouTube knowledge base',
      keywords: ['/yt-kb', '/youtube', 'video', 'transcript'],
    });
  });
});
