// Turns the Vite build into one artifact page: React from cdnjs, our CSS and JS inline.
import { readFileSync, writeFileSync } from 'node:fs'

const js = readFileSync('dist/app.js', 'utf8').replace(/<\/script/gi, '<\\/script')
const css = readFileSync('dist/app.css', 'utf8')
const page = `<title>صالة سُفرة</title>
<meta name="description" content="Sufra floor plan and reservations">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Reem+Kufi:wght@500;600;700&family=IBM+Plex+Mono:wght@500&display=swap">
<style>${css}</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${js}</script>
`
writeFileSync('dist/sufra-floor.html', page)
// A standalone copy that opens directly in a browser for local testing.
writeFileSync('dist/standalone.html', `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${page.split('<div id="root">')[0]}</head><body><div id="root"></div>${page.split('<div id="root"></div>')[1]}</body></html>`)
console.log('page', (page.length / 1024).toFixed(0), 'KB')
