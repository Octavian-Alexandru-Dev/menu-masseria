// Dove gira l'app durante i test: una build di produzione servita da
// `vite preview` su una porta tutta sua (playwright.config.js > webServer),
// mai il server di sviluppo di `npm run dev` (5173) — così i test non si
// agganciano per sbaglio a un server già aperto, collegato chissà a cosa.
export const APP_PORT = 4173;
export const APP_URL = `http://localhost:${APP_PORT}`;
