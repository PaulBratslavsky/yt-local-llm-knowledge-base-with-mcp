import register from './register';
import contentTypes from './content-types';
import controllers from './controllers';
import services from './services';
import routes from './routes';

export default {
  register,
  bootstrap() {},
  destroy() {},
  config: {
    // mcp: register the MCP tools. Defaults to true; set false while migrating
    // from an app that still registers tools with the same names.
    default: { mcp: true },
    validator(config: { mcp?: unknown }) {
      if (config.mcp !== undefined && typeof config.mcp !== 'boolean') {
        throw new Error('yt-kb: `mcp` must be a boolean');
      }
    },
  },
  contentTypes,
  controllers,
  services,
  routes,
};
