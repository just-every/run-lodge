import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The run site's build (rer build --site, src/site/pages.tsx): React only. The docs Markdown is read with
// import.meta.glob, so no docs plugin is needed. Never the app's vite.config.ts, whose Worker plugins do not run in Node.
export default defineConfig({ plugins: [react()] })
