import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App/App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

ReactDOM.createRoot(container).render(<App />);
