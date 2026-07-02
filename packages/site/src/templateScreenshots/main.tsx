import { createRoot } from 'react-dom/client';
import { ScreenshotApp } from './ScreenshotApp';
import './screenshot.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element for template screenshot app.');
}

createRoot(root).render(<ScreenshotApp />);
