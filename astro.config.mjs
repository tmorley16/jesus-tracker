// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  // GitHub Pages serves the site from /jesus-tracker/; the deploy workflow sets these. Local builds stay at the root.
  site: process.env.SITE_URL,
  base: process.env.BASE_PATH ?? '/',
  integrations: [react()],
  trailingSlash: 'always',
  // Not "_astro": names starting with "_" are reserved on the Artifact host used for review builds.
  build: { assets: 'assets' },
  vite: {
    worker: { format: 'es' },
    experimental: {
      // Asset URLs inside scripts resolve relative to the script, so a build also
      // works when it is served from a sub-path (e.g. a review link).
      renderBuiltUrl: (_filename, { hostType }) => (hostType === 'js' ? { relative: true } : undefined),
    },
  },
});
