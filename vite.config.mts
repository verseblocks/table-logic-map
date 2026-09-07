import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * Plugin to fix HTML for PPTB compatibility (from generator-pptb).
 * - Removes type="module" and crossorigin attributes since we're using IIFE format
 * - Moves script tags from head to end of body so DOM is ready when IIFE executes
 */
function fixHtmlForPPTB(): Plugin {
    return {
        name: 'fix-html-for-pptb',
        enforce: 'post',
        transformIndexHtml(html) {
            html = html.replace(/\s*type="module"/g, '');
            html = html.replace(/\s*crossorigin/g, '');
            html = html.replace(/\s+>/g, '>');

            const scriptRegex = /(<script[^>]*src="[^"]*"[^>]*><\/script>)/g;
            const scripts: string[] = [];
            html = html.replace(scriptRegex, (match) => {
                scripts.push(match);
                return '';
            });
            if (scripts.length > 0) {
                const scriptsHtml = '\n  ' + scripts.join('\n  ');
                html = html.replace('</body>', scriptsHtml + '\n</body>');
            }
            return html;
        },
    };
}

// https://vitejs.dev/config/
export default defineConfig((configEnv) => {
    return {
        plugins: [react(), fixHtmlForPPTB()],
        base: './',
        build: {
            outDir: 'dist',
            assetsDir: 'assets',
            sourcemap: configEnv.mode === 'development',
            // The headless build writes dist/headless.js into the same folder, so only the
            // production UI build cleans dist/. In watch mode (`npm run dev-watch`, mode
            // development) Vite re-empties the output directory on *every* rebuild, which would
            // delete dist/headless.js and break headless MCP invocations after the first save;
            // dev therefore leaves existing files in place and `npm run build` still starts clean.
            emptyOutDir: configEnv.mode !== 'development',
            rollupOptions: {
                output: {
                    // IIFE + single file: PPTB loads index.html from dist/ inside a BrowserView.
                    // Vite 8 (rolldown) disables code splitting automatically for IIFE output.
                    format: 'iife',
                },
            },
        },
    };
});
