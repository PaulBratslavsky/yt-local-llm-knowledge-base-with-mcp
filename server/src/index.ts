// yt-kb's content types, Document Service rules, routes and MCP tools all
// live in strapi-plugin-yt-kb (server/src/plugins/yt-kb, loaded in
// config/plugins.ts). The Public role is granted nothing: the app, the site
// and MCP clients each use their own API token.
export default {
  register() {},
  bootstrap() {},
};
