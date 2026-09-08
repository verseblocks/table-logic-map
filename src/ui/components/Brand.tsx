/**
 * VerseBlocks attribution shown in a slim footer.
 *
 * The mark is inlined rather than loaded from a file or a CDN: the tool runs in a sandboxed
 * iframe under a strict CSP with no external origins allowed, so anything fetched over the
 * network would simply not render. It carries its own dark plate, so it reads correctly against
 * both the light and dark Fluent themes without recolouring.
 */
import { Tooltip } from '@fluentui/react-components';
import { useAppStore } from '../store';

export const VERSEBLOCKS_URL = 'https://www.verseblocks.com';

/** The VerseBlocks mark. `idSuffix` keeps the gradient id unique if this is ever rendered twice. */
export function VerseBlocksMark({ size = 16, idSuffix = '' }: { size?: number; idSuffix?: string }) {
    const gradientId = `vb-mark-fg${idSuffix}`;
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="VerseBlocks" focusable="false">
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#E94560" />
                    <stop offset="100%" stopColor="#B8354D" />
                </linearGradient>
            </defs>
            <rect width="32" height="32" rx="7" fill="#0A0A0F" />
            <path d="M8 7h16v3H8z" fill={`url(#${gradientId})`} />
            <path d="M10 7L16 26L22 7" stroke={`url(#${gradientId})`} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function BrandFooter() {
    const openUrl = useAppStore((s) => s.openUrl);
    return (
        <footer className="tlm-brand">
            <Tooltip content={`Open ${VERSEBLOCKS_URL} in your browser`} relationship="label" withArrow>
                <button type="button" className="tlm-brand-link" onClick={() => void openUrl(VERSEBLOCKS_URL)}>
                    <VerseBlocksMark />
                    <span>
                        Table Logic Map by <strong>VerseBlocks</strong>
                    </span>
                </button>
            </Tooltip>
        </footer>
    );
}
