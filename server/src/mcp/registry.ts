import { z } from 'zod';
import type { Core } from '@strapi/strapi';

// The shape every MCP tool body in ./tools implements. Registration itself
// belongs to Strapi's official MCP server — see ../mcp-official/adapter.ts,
// which reads these defs and calls `strapi.ai.mcp.registerTool`.
//
// This file used to also hold a `Map` with registerTool/getTools/getTool:
// the lookup table the retired hand-rolled `/api/mcp` dispatch used to find
// a tool by name (ADR 0008). Nothing called them after that transport was
// deleted — every import here is `import type { ToolDef }` — so they went
// too. Only the types remain.

export type ToolContext = {
  strapi: Core.Strapi;
};

export type ToolDef<Input = unknown, Output = unknown> = {
  /** camelCase identifier — what Claude Desktop / Claude Code will call. */
  name: string;
  /** User-facing description. Include when to use vs. not use. */
  description: string;
  /** Zod schema for the tool input. Converted to JSON Schema for MCP. */
  schema: z.ZodType<Input>;
  /** The handler. Return a string or JSON-serializable object. */
  execute: (args: Input, ctx: ToolContext) => Promise<Output>;
};
