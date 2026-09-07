import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './ui/index.css';

// Ensure DOM is ready and root element exists (the bundle is an IIFE appended to <body>).
const rootElement = document.getElementById('root');
if (rootElement && !rootElement.hasAttribute('data-reactroot-initialized')) {
    rootElement.setAttribute('data-reactroot-initialized', 'true');
    createRoot(rootElement).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
} else if (!rootElement) {
    console.error('Root element not found. Make sure the HTML contains <div id="root"></div>');
}
