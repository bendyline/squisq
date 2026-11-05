import { createRoot } from 'react-dom/client';
import { DeckReviewApp } from './DeckReviewApp';
import './deckReview.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element for the deck review harness.');

createRoot(root).render(<DeckReviewApp />);
