import { createRoot } from 'react-dom/client';
import { CrossBrowserApp } from './CrossBrowserApp';
import './crossBrowser.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element for the cross-browser review harness.');

createRoot(root).render(<CrossBrowserApp />);
