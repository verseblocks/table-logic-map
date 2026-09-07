import { defineConfig } from 'vite';

/**
 * Builds the agent/MCP headless entry (src/headless.ts) to dist/headless.js as a
 * single CommonJS file. PPTB loads it in Node (Electron main) via dynamic import and
 * resolves `invokeHeadless` from `module.exports` or `module.exports.default`.
 *
 * No DOM is available in that runtime: everything imported from here must be UI-free.
 */
export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: false,
        sourcemap: false,
        minify: false,
        target: 'node18',
        lib: {
            entry: 'src/headless.ts',
            formats: ['cjs'],
            fileName: () => 'headless.js',
        },
        rollupOptions: {
            // Bundle everything (fast-xml-parser included); PPTB installs only `files`.
            external: [],
            output: {
                exports: 'named',
                codeSplitting: false,
            },
        },
    },
    resolve: {
        conditions: ['node'],
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
});
