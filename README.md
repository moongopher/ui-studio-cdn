# UI Studio CDN

CDN hosting for UI Studio mockup engine files served via jsDelivr.

## CDN URLs

- CSS: https://cdn.jsdelivr.net/gh/moongopher/ui-studio-cdn@main/mockup/engine.css
- JS: https://cdn.jsdelivr.net/gh/moongopher/ui-studio-cdn@main/mockup/engine.js

## Auto-Deployment

Engine files are automatically deployed from the [ui-studio](https://github.com/moongopher/ui-studio) repository via GitHub Actions when changes are pushed to `engine/` directory.

## Purge CDN Cache

Force refresh CDN cache:

```bash
curl https://purge.jsdelivr.net/gh/moongopher/ui-studio-cdn@main/mockup/engine.js
curl https://purge.jsdelivr.net/gh/moongopher/ui-studio-cdn@main/mockup/engine.css
```

## Version

Current engine version: 0.6
