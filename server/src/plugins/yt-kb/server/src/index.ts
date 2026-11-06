import type { Core } from '@strapi/strapi';

// Step 1 skeleton: proves the plugin loads in the host before anything
// moves into it.
export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    strapi.log.info('[yt-kb] plugin registered');
  },
  bootstrap() {},
  destroy() {},
  config: { default: {}, validator() {} },
  contentTypes: {},
  controllers: {},
  routes: {},
  services: {},
};
