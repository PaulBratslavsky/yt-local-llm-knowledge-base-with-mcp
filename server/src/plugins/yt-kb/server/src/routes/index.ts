import { FETCH_TRANSCRIPT_ACTION } from '../mcp-official/permissions';

// Content API routes, served under the plugin prefix: /api/yt-kb/<plural>.
// The prefix is kept on purpose — the host this plugin targets already has a
// `tag` content type of its own, so /api/tags would collide.
//
// String handlers get an auto-generated scope (plugin::yt-kb.<type>.<action>),
// which is what API tokens and roles are granted. Nothing is granted to the
// Public role: the app writes with a Content API token, the site reads with a
// read-only one.
const crud = (singular: string, plural: string) => [
  { method: 'GET' as const, path: `/${plural}`, handler: `${singular}.find` },
  { method: 'GET' as const, path: `/${plural}/:id`, handler: `${singular}.findOne` },
  { method: 'POST' as const, path: `/${plural}`, handler: `${singular}.create` },
  { method: 'PUT' as const, path: `/${plural}/:id`, handler: `${singular}.update` },
  { method: 'DELETE' as const, path: `/${plural}/:id`, handler: `${singular}.delete` },
];

export default {
  'content-api': {
    type: 'content-api' as const,
    routes: [
      ...crud('video', 'videos'),
      ...crud('tag', 'tags'),
      ...crud('transcript', 'transcripts'),
      ...crud('note', 'notes'),
      ...crud('digest', 'digests'),
      // Fetch a transcript from YouTube and store it — see services/fetcher.ts.
      { method: 'POST' as const, path: '/transcripts/fetch', handler: 'fetcher.fetchTranscript' },
      // Stored transcript, or fetch and store it — same path as
      // strapi-plugin-youtube-transcripts. Accepts an id or a YouTube URL.
      { method: 'GET' as const, path: '/yt-transcript/:videoId', handler: 'fetcher.getOrFetch' },
      // Bulk copy that keeps documentIds and dates — see services/importer.ts.
      { method: 'POST' as const, path: '/import/:type', handler: 'importer.importRecords' },
    ],
  },
  // Admin API, served at /yt-kb/yt-transcript/:videoId: an admin session or an
  // admin API token holding the "Fetch transcript" permission.
  admin: {
    type: 'admin' as const,
    routes: [
      {
        method: 'GET' as const,
        path: '/yt-transcript/:videoId',
        handler: 'fetcher.getOrFetch',
        config: {
          policies: [{ name: 'admin::hasPermissions', config: { actions: [FETCH_TRANSCRIPT_ACTION] } }],
        },
      },
    ],
  },
};
