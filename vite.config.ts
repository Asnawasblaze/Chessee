import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs in the build output. The default (`/`) emits
  // `/assets/index-*.js`, which only resolves when the page is served from a
  // domain root — opening `dist/index.html` from the filesystem resolves it
  // against the drive root instead, every request 404s, and the page is a blank
  // `#root` with no error visible on the page itself. Relative paths work from
  // the filesystem, from a domain root, and from a sub-path deployment alike.
  // Safe here because this is one document with fragment anchors: there are no
  // nested client-side routes for a relative base to resolve against.
  base: './',
  plugins: [react()],
  // Ensure GLB/GLTF 3D models are treated as static assets and returned as
  // resolved URLs from imports (used by the features knight model).
  assetsInclude: ['**/*.glb', '**/*.gltf'],
})
