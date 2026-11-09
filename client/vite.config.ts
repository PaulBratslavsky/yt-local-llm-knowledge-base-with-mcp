import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // Loopback only (B-5). The app has no sign-in and acts with the
  // yt-kb-app token, so nothing but this machine may reach it.
  // strictPort: fail on a busy port instead of drifting to the next one.
  server: { host: '127.0.0.1', port: 3005, strictPort: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
})

export default config
