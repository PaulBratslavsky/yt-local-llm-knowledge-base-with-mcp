// The yt-knowledge-base domain tools registered on the official MCP server.
//
// Each entry is metadata only: which body, a human title, and what that body
// does to the world. The input schema comes from the tool itself.
//
// It used to carry a second, hand-written copy of every tool's input schema
// (zod 3 here, zod 4 on the body) because the two zods weren't
// interchangeable. Only this copy was enforced at runtime, `ToolDef<any,
// any>` erased the body's type, and `strict: false` meant tsc couldn't see
// the difference — so adding a field to a body and forgetting the copy left
// the body destructuring `undefined`, silently. The bodies now declare their
// schemas in the same zod 3 the SDK needs, and the adapter passes
// `tool.schema` straight through. One declaration, no drift possible.
//
// `sideEffects` replaces the old hand-typed `access` tier: the admin action
// that gates a tool is derived from what its body does (see adapter.ts), so
// a mutating tool can't be labelled read-only by a typo.
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
import { reindexEmbeddingsTool } from '../mcp/tools/reindex-embeddings';
import { generateDigestTool } from '../mcp/tools/generate-digest';

export const domainTools: DomainTool[] = [
  // ---- Queries (gated by api::yt-kb-mcp.read) ----
  { tool: libraryStatsTool, title: 'Library stats overview', sideEffects: 'none' },
  { tool: listVideosTool, title: 'List videos', sideEffects: 'none' },
  { tool: searchVideosTool, title: 'Search videos', sideEffects: 'none' },
  { tool: getVideoTool, title: 'Get a video', sideEffects: 'none' },
  { tool: getTranscriptTool, title: 'Get a transcript', sideEffects: 'none' },
  { tool: searchTranscriptTool, title: 'Search within a transcript', sideEffects: 'none' },
  { tool: findTranscriptsTool, title: 'Find transcripts', sideEffects: 'none' },
  { tool: crossSearchTranscriptsTool, title: 'Search across transcripts', sideEffects: 'none' },
  { tool: listTranscriptsTool, title: 'List transcripts', sideEffects: 'none' },
  { tool: aggregateByTagTool, title: 'Aggregate videos by tag', sideEffects: 'none' },
  { tool: listUntaggedTool, title: 'List untagged videos', sideEffects: 'none' },
  { tool: listTagsTool, title: 'List tags', sideEffects: 'none' },
  { tool: relatedVideosTool, title: 'Related videos', sideEffects: 'none' },
  { tool: getReadableArticleTool, title: 'Get the readable article', sideEffects: 'none' },
  // Reads the compiled summaries and hands them back for the CALLER to
  // synthesize — no LLM, no network, no writes. It was tiered `maintenance`
  // on an "LLM cost" premise its own header disclaims, which kept the
  // documented browse-and-annotate token from calling a read-only tool.
  { tool: generateDigestTool, title: 'Generate a digest', sideEffects: 'none' },

  // ---- Mutations (gated by api::yt-kb-mcp.write) ----
  { tool: saveSummaryTool, title: 'Save a video summary', sideEffects: 'write' },
  { tool: tagVideoTool, title: 'Tag a video', sideEffects: 'write' },
  { tool: untagVideoTool, title: 'Untag a video', sideEffects: 'write' },
  { tool: saveNoteTool, title: 'Save a note', sideEffects: 'write' },

  // ---- Leaves the box (gated by api::yt-kb-mcp.maintenance) ----
  { tool: addVideoTool, title: 'Add a video', sideEffects: 'external' },
  { tool: fetchTranscriptTool, title: 'Fetch a transcript from YouTube', sideEffects: 'external' },
  { tool: reindexEmbeddingsTool, title: 'Reindex topical embeddings', sideEffects: 'external' },
];
