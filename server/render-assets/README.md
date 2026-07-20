# Render assets

`card-dist/` is the production build of `entari_plugin_hyw/browser/card-ui`
(Vue single-file HTML). Playwright opens `/__render/card/` and screenshots
`#main-container` for both web download and bot `/api/render*` responses.

To refresh from the HYW source:

```bash
cd /path/to/entari_plugin_hyw/browser/card-ui && npm run build
rsync -a --delete ../assets/card-dist/ \
  /path/to/pi-web-platform/server/render-assets/card-dist/
```
