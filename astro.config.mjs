// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://nofn.gunnthor.is',
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
});
