import { fileURLToPath } from 'node:url'

import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    server: './src/runtime/node/main.ts',
    services: './src/runtime/node/services/main.ts',
    // Approving and granting the first administrator from inside a running container.
    admin: './src/runtime/node/admin.ts'
  },
  platform: 'node',
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  outDir: './dist-standalone',
  target: 'node22',
  deps: { alwaysBundle: [/.*/], neverBundle: [/^node:/] },
  inputOptions: {
    resolve: {
      alias: {
        '#cloud': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  }
})
