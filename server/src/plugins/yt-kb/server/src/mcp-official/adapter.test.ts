import { describe, expect, it, vi } from 'vitest';
import { z } from '@strapi/utils';
import { registerDomainTool } from './adapter';
import { registerOfficialMcpTools } from './index';

const fakeStrapi = (registerTool: (def: any) => void) => {
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const registerMany = vi.fn(async () => {});
  const strapi = {
    log,
    service: vi.fn(() => ({ actionProvider: { registerMany } })),
    ai: { mcp: { isEnabled: () => true, registerTool } },
  };
  return { strapi: strapi as any, log, registerMany };
};

describe('MCP registration', () => {
  it('registers 21 prefixed tools, each gated by its own action', async () => {
    const defs: any[] = [];
    const { strapi, registerMany } = fakeStrapi((d) => defs.push(d));
    await registerOfficialMcpTools(strapi, { toolsEnabled: true });
    expect(defs).toHaveLength(21);
    for (const d of defs) {
      expect(d.name).toMatch(/^yt_kb__/);
      expect(d.title).toMatch(/^YT Knowledge Base: /);
      expect(d.auth.policies).toHaveLength(1);
      expect(d.auth.policies[0].action).toMatch(/^plugin::yt-kb\.tool\.[a-z-]+$/);
    }
    expect(defs.find((d) => d.name === 'yt_kb__get_video').auth.policies[0].action).toBe('plugin::yt-kb.tool.get-video');
    // 21 tool actions + 3 legacy tiers, in one call, no uid twice (the
    // provider throws on a duplicate — M3's hand-added fetch-transcript
    // entry is gone)
    const uids = (registerMany.mock.calls[0] as any)[0].map((d: any) => d.uid);
    expect(uids).toHaveLength(24);
    expect(new Set(uids).size).toBe(24);
    expect(uids.filter((u: string) => u === 'tool.fetch-transcript')).toHaveLength(1);
  });

  it('logs and skips a tool whose registration throws, and keeps going', async () => {
    const defs: any[] = [];
    const { strapi, log } = fakeStrapi((d) => {
      if (d.name === 'yt_kb__get_video') throw new Error('already registered');
      defs.push(d);
    });
    await expect(registerOfficialMcpTools(strapi, { toolsEnabled: true })).resolves.toBeUndefined();
    expect(defs).toHaveLength(20);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[yt-kb\] skipped MCP tool yt_kb__get_video: already registered/),
      { name: 'yt_kb__get_video' },
    );
  });

  it('registers permissions but no tools when mcp is off', async () => {
    const registerTool = vi.fn();
    const { strapi, registerMany } = fakeStrapi(registerTool);
    await registerOfficialMcpTools(strapi, { toolsEnabled: false });
    expect(registerMany).toHaveBeenCalledTimes(1);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it('logs a failing tool body and rethrows', async () => {
    let def: any;
    const { strapi, log } = fakeStrapi((d) => { def = d; });
    const ok = registerDomainTool(strapi.ai.mcp.registerTool, strapi, {
      tool: { name: 'boomTool', description: 'x', schema: z.object({}), execute: async () => { throw new Error('boom'); } },
      sideEffects: 'none',
    });
    expect(ok).toBe(true);
    await expect(def.createHandler(strapi)({ args: {} })).rejects.toThrow('boom');
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[yt-kb\] MCP tool failed yt_kb__boom_tool: boom/),
      { name: 'yt_kb__boom_tool' },
    );
  });
});
