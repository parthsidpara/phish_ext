import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'phish_ext',
    host_permissions: ['*://*/*'],
    permissions: ['storage', 'tabs', 'offscreen', 'webNavigation'],
  },
});
