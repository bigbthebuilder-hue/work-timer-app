# Work Timer PWA

Phone-first Vercel version of the Work Timer app.

## Data storage

This version saves data locally on the phone/browser using `localStorage`.

That means:
- fast button response
- works offline after first load
- no Google Sheets required
- clearing browser data can erase records

Use Export CSV to back up records.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Upload this folder to a GitHub repository.
2. In Vercel, click Add New Project.
3. Import the GitHub repo.
4. Framework preset: Vite.
5. Build command: `npm run build`.
6. Output directory: `dist`.
7. Deploy.

## Install on phone

Open the Vercel app link on your phone, then use:
- Chrome/Android: menu → Add to Home screen / Install app
- iPhone/Safari: Share → Add to Home Screen
