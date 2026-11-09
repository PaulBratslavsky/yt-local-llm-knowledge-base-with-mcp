import { describe, expect, it } from 'vitest';
import { domainTools } from './tools';
import { mcpToolName, toolActionId, toolActionUid, toolDisplayName, toolTitle } from './names';

const BASE = [
  'libraryStats', 'listVideos', 'searchVideos', 'getVideo', 'getTranscript',
  'searchTranscript', 'findTranscripts', 'crossSearchTranscripts', 'listTranscripts',
  'aggregateByTag', 'listUntagged', 'listTags', 'relatedVideos', 'getReadableArticle',
  'generateDigest', 'saveSummary', 'tagVideo', 'untagVideo', 'saveNote', 'addVideo',
  'fetchTranscript',
];
const MCP = [
  'yt_kb__library_stats', 'yt_kb__list_videos', 'yt_kb__search_videos', 'yt_kb__get_video',
  'yt_kb__get_transcript', 'yt_kb__search_transcript', 'yt_kb__find_transcripts',
  'yt_kb__cross_search_transcripts', 'yt_kb__list_transcripts', 'yt_kb__aggregate_by_tag',
  'yt_kb__list_untagged', 'yt_kb__list_tags', 'yt_kb__related_videos',
  'yt_kb__get_readable_article', 'yt_kb__generate_digest', 'yt_kb__save_summary',
  'yt_kb__tag_video', 'yt_kb__untag_video', 'yt_kb__save_note', 'yt_kb__add_video',
  'yt_kb__fetch_transcript',
];
const ACTIONS = [
  'library-stats', 'list-videos', 'search-videos', 'get-video', 'get-transcript',
  'search-transcript', 'find-transcripts', 'cross-search-transcripts', 'list-transcripts',
  'aggregate-by-tag', 'list-untagged', 'list-tags', 'related-videos', 'get-readable-article',
  'generate-digest', 'save-summary', 'tag-video', 'untag-video', 'save-note', 'add-video',
  'fetch-transcript',
].map((k) => `plugin::yt-kb.tool.${k}`);

describe('tool names', () => {
  it('keeps the 21 base names in order', () => {
    expect(domainTools.map((d) => d.tool.name)).toEqual(BASE);
  });
  it('maps every tool to its yt_kb__ MCP name', () => {
    expect(domainTools.map((d) => mcpToolName(d.tool.name))).toEqual(MCP);
  });
  it('maps every tool to its own admin action', () => {
    expect(domainTools.map((d) => toolActionId(d.tool.name))).toEqual(ACTIONS);
  });
  it('produces valid, unique MCP names', () => {
    expect(new Set(MCP).size).toBe(21);
    for (const n of MCP) expect(n).toMatch(/^[a-z0-9_]{1,64}$/);
  });
  it("derives titles and labels in youtube-transcripts' shape", () => {
    expect(toolTitle('crossSearchTranscripts')).toBe('YT Knowledge Base: Cross Search Transcripts');
    expect(toolTitle('getVideo')).toBe('YT Knowledge Base: Get Video');
    expect(toolDisplayName('getReadableArticle')).toBe('Get readable article');
    expect(toolActionUid('getVideo')).toBe('tool.get-video');
  });
  it('keeps the 15 / 4 / 2 side-effect split the legacy migration relies on', () => {
    const count = (s: string) => domainTools.filter((d) => d.sideEffects === s).length;
    expect([count('none'), count('write'), count('external')]).toEqual([15, 4, 2]);
  });
});
