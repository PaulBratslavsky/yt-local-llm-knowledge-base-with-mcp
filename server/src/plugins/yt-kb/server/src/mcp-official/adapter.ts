// Adapter: register a yt-knowledge-base domain ToolDef on the OFFICIAL Strapi
// MCP server (strapi.ai.mcp.registerTool).
//
// FROM the tool: its camelCase base name, description, input schema (the zod
// 4 API from `@strapi/utils`) and execute body. ADDED here: the prefixed MCP name,
// the title and the per-tool admin action (all from ./names), the output
// schema, the result-size backstop, and logging.
//
// Registration never throws: in "any Strapi app" another plugin may already
// hold a name, and a throw here would stop the host booting (M-1). A failing
// tool body is logged, then rethrown so Strapi reports it to the client as
// `Tool "<name>" execution failed: <message>`.
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { ToolDef } from '../mcp/registry';
import { mcpToolName, toolActionId, toolTitle } from './names';

type RegisterTool = Core.Strapi['ai']['mcp']['registerTool'];

/** What a tool does to the world. Since the per-tool permissions it no longer
 *  picks the admin action (every tool has its own, plugin::yt-kb.tool.<kebab>).
 *  It is kept as metadata for one consumer: the boot-time migration of the
 *  three legacy tier grants (permission-seeding/legacy-grants.ts), which maps
 *  none → plugin::yt-kb.read, write → .write, external → .maintenance.
 *
 *  none     — queries only
 *  write    — mutates yt-kb data
 *  external — leaves the box (YouTube) */
export type SideEffects = 'none' | 'write' | 'external';

export type DomainTool = {
  /** The domain tool — supplies name, description, schema and execute body. */
  tool: ToolDef<any, any>;
  /** What the body does (legacy-tier mapping only; see SideEffects). */
  sideEffects: SideEffects;
  /**
   * Output schema. Defaults to a permissive object (any shape).
   * structuredContent is always normalized to an object so this validates.
   */
  output?: z.ZodObject<z.ZodRawShape>;
};

const LOOSE_OUTPUT = z.object({}).catchall(z.any());

// MCP clients reject a tool result over 1 MB with an opaque "Tool result is
// too large". The result rides the wire twice (content text +
// structuredContent) plus a small envelope, so the doubled size is measured.
const MAX_WIRE_BYTES = 950_000;

/** Hints, by tool base name, for how to make an oversized result smaller. */
function shrinkHint(baseName: string): string {
  switch (baseName) {
    case 'getTranscript':
      return 'Use mode:"chunked" with page/pageSize to page segments, mode:"timeRange" for a specific window, or mode:"full" with offset/maxChars.';
    case 'findTranscripts':
      return 'Set includeFullContent:false (the default) or lower `limit`.';
    case 'crossSearchTranscripts':
      return 'Lower `perVideo` and/or `maxVideos`.';
    case 'searchTranscript':
      return 'Lower `k`.';
    default:
      return 'Re-issue with pagination / a smaller page size, or request fewer fields.';
  }
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Registers one tool. Returns false (and logs) instead of throwing. */
export function registerDomainTool(
  registerTool: RegisterTool,
  strapi: Core.Strapi,
  def: DomainTool,
): boolean {
  const { tool } = def;
  const name = mcpToolName(tool.name);
  const output = def.output ?? LOOSE_OUTPUT;
  const input = tool.schema as z.ZodObject<z.ZodRawShape> | undefined;

  try {
    registerTool({
      name,
      title: toolTitle(tool.name),
      description: tool.description,
      ...(input ? { resolveInputSchema: () => input } : {}),
      resolveOutputSchema: () => output,
      auth: { policies: [{ action: toolActionId(tool.name) }] },
      createHandler: (s: Core.Strapi) => async ({ args }: { args?: unknown }) => {
        let rawResult: unknown;
        try {
          rawResult = await tool.execute(args ?? {}, { strapi: s });
        } catch (err) {
          const message = errorMessage(err);
          s.log.warn(`[yt-kb] MCP tool failed ${name}: ${message}`, { name });
          throw err;
        }

        const bytes = Buffer.byteLength(JSON.stringify(rawResult), 'utf8');
        const wireBytes = bytes * 2 + 2048;
        const result =
          wireBytes > MAX_WIRE_BYTES
            ? {
                error: 'RESULT_TOO_LARGE',
                tool: name,
                bytes: wireBytes,
                limitBytes: MAX_WIRE_BYTES,
                message: `This ${name} result is ~${(wireBytes / 1_000_000).toFixed(2)} MB on the wire (sent twice), over the ~1 MB MCP response limit. ${shrinkHint(tool.name)}`,
              }
            : rawResult;

        // structuredContent must be an object (the schema is a ZodObject).
        const structuredContent =
          result && typeof result === 'object' && !Array.isArray(result)
            ? (result as Record<string, unknown>)
            : { result };
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent,
        };
      },
    });
    return true;
  } catch (err) {
    const message = errorMessage(err);
    strapi.log.warn(`[yt-kb] skipped MCP tool ${name}: ${message}`, { name });
    return false;
  }
}
