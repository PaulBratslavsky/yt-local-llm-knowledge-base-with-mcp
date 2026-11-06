import register from './register';
import contentTypes from './content-types';
import controllers from './controllers';
import services from './services';
import routes from './routes';

export default {
  register,
  bootstrap() {},
  destroy() {},
  config: { default: {}, validator() {} },
  contentTypes,
  controllers,
  services,
  routes,
};
