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
    ],
  },
};
