# claw-browser-plugin-twitter-example

Domain-specific example plugin for X/Twitter-style workflows.

## What it adds

- Plugin id: `twitter_site`
- Tool: `twitter_site_capture_top_post_text`
- Tool: `twitter_site_prepare_post_draft` (disabled by default)

## Build

```bash
cd plugins-examples/twitter-plugin
bun run build
```

## Configure (local path example)

```json
{
  "plugins": {
    "entries": {
      "claw-browser-automation": {
        "enabled": true,
        "config": {
          "sitePlugins": [
            {
              "module": "./plugins-examples/twitter-plugin/dist/index.js",
              "enabled": true,
              "options": {
                "allowDraftWrite": false
              }
            }
          ]
        }
      }
    }
  }
}
```

## Options

- `hosts`: custom host allowlist (default includes `x.com` and `twitter.com`)
- `feedTextSelector`: selector for first post text
- `composerSelector`: selector for composer textbox
- `allowDraftWrite`: must be `true` to enable draft fill tool
