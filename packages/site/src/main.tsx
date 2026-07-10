import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Wire Monaco's language-service workers before anything mounts.
import './setupMonacoWorkers';

// DocPlayer animations (used by the Preview panel slideshow)
import '@bendyline/squisq-react/styles';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
