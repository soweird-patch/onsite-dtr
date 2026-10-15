import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).end();
  let branding = { appName: 'Onsite DTR', logo192Url: null, logo512Url: null };
  try {
    const url = process.env.VITE_CONVEX_URL;
    if (url) branding = await new ConvexHttpClient(url).query(api.core.branding, {});
  } catch { /* The default manifest remains installable during a backend outage. */ }
  const name = branding.appName || 'Onsite DTR';
  const manifest = {
    name,
    short_name: name.slice(0, 12),
    description: 'Employee attendance and payroll cutoff records',
    start_url: '/', scope: '/', display: 'standalone',
    background_color: '#07121f', theme_color: '#0d2034',
    icons: [
      { src: branding.logo192Url || '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: branding.logo512Url || '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  };
  response.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  response.status(200).end(JSON.stringify(manifest));
}
