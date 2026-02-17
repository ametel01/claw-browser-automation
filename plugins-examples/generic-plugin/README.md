# claw-browser-plugin-generic-example

Example external plugin for `claw-browser-automation` `sitePlugins`.

## What it adds

- Plugin id: `example_site`
- Tool: `example_site_capture_marker_text` (auto-prefixed by core loader)

## Install locally

From the root project:

```bash
bun add ./plugins-examples/generic-plugin
```

Build the plugin package:

```bash
cd plugins-examples/generic-plugin
bun run build
```

## Configure

```json
{
  "plugins": {
    "entries": {
      "claw-browser-automation": {
        "enabled": true,
        "config": {
          "sitePlugins": [
            {
              "module": "claw-browser-plugin-generic-example",
              "enabled": true,
              "options": {
                "markerSelector": "h1"
              }
            }
          ]
        }
      }
    }
  }
}
```

For local path loading from this repository:

```json
{
  "sitePlugins": [
    { "module": "./plugins-examples/generic-plugin/dist/index.js" }
  ]
}
```

## Tool behavior

`capture_marker_text` accepts:

- `sessionId` (required)
- `selector` (optional, defaults to configured `markerSelector`)

It returns the first matched element's text from the current page.
