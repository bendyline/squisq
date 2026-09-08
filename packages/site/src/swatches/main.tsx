import { createRoot } from 'react-dom/client';
import { SwatchApp } from './SwatchApp';
import './swatch.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element for the swatch harness.');

createRoot(root).render(<SwatchApp />);
