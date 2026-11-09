// The yt-knowledge-base domain tools, registered on the official MCP server
// (adapter.ts) and offered to strapi-plugin-tanstack-ai (services/ai-tools.ts).
//
// Each entry is metadata only: which body, and what that body does to the
// world. Name, title and admin action are derived from tool.name
// (names.ts); the input schema comes from the tool itself. `sideEffects`
// only feeds the legacy tier-grant migration (see adapter.ts SideEffects).
import type { DomainTool } from './adapter';

import { libraryStatsTool } from '../mcp/tools/library-stats';
import { listVideosTool } from '../mcp/tools/list-videos';
import { searchVideosTool } from '../mcp/tools/search-videos';
import { getVideoTool } from '../mcp/tools/get-video';
import { getTranscriptTool } from '../mcp/tools/get-transcript';
import { searchTranscriptTool } from '../mcp/tools/search-transcript';
import { findTranscriptsTool } from '../mcp/tools/find-transcripts';
import { crossSearchTranscriptsTool } from '../mcp/tools/cross-search-transcripts';
import { listTranscriptsTool } from '../mcp/tools/list-transcripts';
import { aggregateByTagTool } from '../mcp/tools/aggregate-by-tag';
import { listUntaggedTool } from '../mcp/tools/list-untagged';
import { listTagsTool, tagVideoTool, untagVideoTool } from '../mcp/tools/tags';
import { relatedVideosTool } from '../mcp/tools/related-videos';
import { getReadableArticleTool } from '../mcp/tools/get-readable-article';
import { addVideoTool } from '../mcp/tools/add-video';
import { saveSummaryTool } from '../mcp/tools/save-summary';
import { saveNoteTool } from '../mcp/tools/save-note';
import { fetchTranscriptTool } from '../mcp/tools/fetch-transcript';
import { generateDigestTool } from '../mcp/tools/generate-digest';

export const domainTools: DomainTool[] = [
  // ---- Queries (legacy tier plugin::yt-kb.read) ----
  { tool: libraryStatsTool, sideEffects: 'none' },
  { tool: listVideosTool, sideEffects: 'none' },
  { tool: searchVideosTool, sideEffects: 'none' },
  { tool: getVideoTool, sideEffects: 'none' },
  { tool: getTranscriptTool, sideEffects: 'none' },
  { tool: searchTranscriptTool, sideEffects: 'none' },
  { tool: findTranscriptsTool, sideEffects: 'none' },
  { tool: crossSearchTranscriptsTool, sideEffects: 'none' },
  { tool: listTranscriptsTool, sideEffects: 'none' },
  { tool: aggregateByTagTool, sideEffects: 'none' },
  { tool: listUntaggedTool, sideEffects: 'none' },
  { tool: listTagsTool, sideEffects: 'none' },
  { tool: relatedVideosTool, sideEffects: 'none' },
  { tool: getReadableArticleTool, sideEffects: 'none' },
  // Reads compiled summaries for the CALLER to synthesize — no LLM, no writes.
  { tool: generateDigestTool, sideEffects: 'none' },

  // ---- Mutations (legacy tier plugin::yt-kb.write) ----
  { tool: saveSummaryTool, sideEffects: 'write' },
  { tool: tagVideoTool, sideEffects: 'write' },
  { tool: untagVideoTool, sideEffects: 'write' },
  { tool: saveNoteTool, sideEffects: 'write' },

  // ---- Leaves the box (legacy tier plugin::yt-kb.maintenance) ----
  { tool: addVideoTool, sideEffects: 'external' },
  { tool: fetchTranscriptTool, sideEffects: 'external' },
];
