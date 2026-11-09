// Tools for strapi-plugin-tanstack-ai's admin chat (goal G6), in the same
// contract strapi-plugin-youtube-transcripts uses: tanstack-ai calls
// strapi.plugin('yt-kb').service('ai-tools').getTools() synchronously, keeps
// tools whose `action` is a registered admin action, names them
// `yt-kb__<name>`, parses the arguments with `schema` (Standard JSON Schema:
// zod ≥ 4.2, which @strapi/utils 5.61 ships) and calls
// execute(args, strapi, {}). An admin sees a tool only if their role holds
// its action (super admins hold all).
import type { Core } from '@strapi/strapi';
import { domainTools } from '../mcp-official/tools';
import { toolActionId } from '../mcp-official/names';

export type AiTool = {
  name: string;
  description: string;
  schema: unknown;
  execute: (args: unknown, strapi: Core.Strapi, ctx?: unknown) => Promise<unknown>;
  action: string;
};

export const AI_TOOLS_META = {
  label: 'YT Knowledge Base',
  description: 'Search, read and add to the YouTube knowledge base',
  keywords: ['/yt-kb', '/youtube', 'video', 'transcript'],
};

export default (_deps: { strapi: Core.Strapi }) => ({
  getTools(): AiTool[] {
    return domainTools.map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      execute: (args: unknown, strapi: Core.Strapi, _ctx?: unknown) =>
        tool.execute((args ?? {}) as never, { strapi }),
      action: toolActionId(tool.name),
    }));
  },
  getMeta() {
    return { ...AI_TOOLS_META, keywords: [...AI_TOOLS_META.keywords] };
  },
});
