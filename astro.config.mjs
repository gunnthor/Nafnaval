// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://nafnaval.is',
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
});
