# Slack Site Plugin (example)

Adds two Slack-focused tools for the browser automation layer:

- `slack_site_read_activity_notifications` — extracts latest entries from Slack Activity.
- `slack_site_reply_in_open_thread` — replies in the currently open Slack thread/channel composer.

## Build

```bash
cd plugins-examples/slack-plugin
npm install
npm run build
```

## Load in OpenClaw config

```json
{
  "sitePlugins": [
    { "module": "./plugins-examples/slack-plugin/dist/index.js" }
  ]
}
```

## Notes

- Keep Slack open on `app.slack.com`.
- For replying, open the target thread first, then call `reply_in_open_thread`.
