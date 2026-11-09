// Names derived from a tool's camelCase base name (ToolDef.name), in
// strapi-plugin-youtube-transcripts' shapes (MIT, same author):
//   MCP tool name   yt_kb__<snake_case>             getVideo → yt_kb__get_video
//   admin action    plugin::yt-kb.tool.<kebab>      getVideo → plugin::yt-kb.tool.get-video
//   MCP title       YT Knowledge Base: <Each Word>  getVideo → YT Knowledge Base: Get Video
//   action label    <First word capitalised>        getVideo → Get video
// The prefix keeps yt-kb's names from clashing with any other plugin's on a
// shared /mcp (M-1). ai-tools keeps the bare base name: tanstack-ai adds its
// own `yt-kb__` prefix.
export const PLUGIN_ID = 'yt-kb';
export const MCP_TOOL_PREFIX = 'yt_kb__';
export const MCP_TITLE_PREFIX = 'YT Knowledge Base: ';

const toSnake = (name: string): string => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toKebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const mcpToolName = (name: string): string => `${MCP_TOOL_PREFIX}${toSnake(name)}`;

/** The action uid as registered (section 'plugins' adds `plugin::yt-kb.`). */
export const toolActionUid = (name: string): string => `tool.${toKebab(name)}`;

/** The full action id a token or role is granted. */
export const toolActionId = (name: string): string => `plugin::${PLUGIN_ID}.${toolActionUid(name)}`;

export const toolDisplayName = (name: string): string => {
  const words = toKebab(name).replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const toolTitle = (name: string): string => {
  const words = name.replace(/[A-Z]/g, (c) => ` ${c}`);
  return `${MCP_TITLE_PREFIX}${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};
