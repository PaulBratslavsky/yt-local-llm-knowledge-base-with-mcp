// Astro generates types for `.astro` imports inside `.astro` files, but not
// for a `.ts` file importing one — which the component tests do, since
// rendering a component through the container API is how the empty-array
// cases are covered. `astro check` would resolve these, but its integration
// does not support Astro 6 yet.
declare module '*.astro' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

  const Component: AstroComponentFactory;
  export default Component;
}
