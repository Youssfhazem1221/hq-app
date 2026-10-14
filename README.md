# HQ app

A small dashboard (Vite + React) for a markdown workspace kept in a **private** GitHub repo.

- This repo holds **code only**. No data is bundled.
- Data loads at runtime from the private repo, using a fine-grained GitHub token the user pastes into Settings. The token is stored only in their browser.
- Pages: dashboard, board, to-dos, docs, people, Ask AI. Light and dark mode.

```bash
npm install
npm run dev     # local mode reads ../ (the workspace folder)
npm run build   # static build → dist/ (deployed by .github/workflows/deploy.yml)
```
