# Traffic matrix Worker

Cloudflare Worker that holds the Google API key and returns only a travel-time matrix
(Google Routes `computeRouteMatrix`, `TRAFFIC_AWARE`). Only coordinates pass through it; nothing is logged.

## Deploy

1. Google Cloud: create a project with billing, enable **Routes API**, create an API key
   restricted to the Routes API. Set a daily quota cap on `ComputeRouteMatrix` to limit cost.
2. From this folder:
   ```
   npx wrangler login
   npx wrangler secret put GOOGLE_API_KEY
   npx wrangler deploy
   ```
3. Put the printed `https://route-planner-matrix.<you>.workers.dev` URL into `TRAFFIC_API` in `../index.html`.

Allowed page origins are set in `wrangler.toml` (`ALLOWED_ORIGINS`). Without `TRAFFIC_API`, or if the
Worker fails, the page falls back to OSRM (no traffic).
