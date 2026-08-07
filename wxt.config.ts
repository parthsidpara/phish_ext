import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'phish_ext',
    host_permissions: ['*://*/*'],
    permissions: ['storage', 'tabs', 'offscreen', 'webNavigation'],
    commands: {
      'run-highlight-demo': {
        suggested_key: { default: 'Ctrl+Shift+H' }, // temporary shortcut for demo purpose
        description: 'Run the Driver.js highlight demo on the current page',
      },
    },
  },
});
