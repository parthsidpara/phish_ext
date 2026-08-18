import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'phish_ext',
    host_permissions: ['<all_urls>', 'http://localhost/*', 'http://127.0.0.1/*'],
    permissions: ['storage', 'tabs', 'offscreen', 'webNavigation'],
    commands: {
      rescan: {
        suggested_key: { default: 'Ctrl+Shift+H' },
        description: 'Re-run phishing detection on the current page',
      },
    },
  },
});
