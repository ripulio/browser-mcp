---
name: browser-control
description: This skill should be used when the user asks to "control the browser", "open a tab", "list browser tabs", "close a tab", "interact with a web page", "use browser tools", "call a page tool", or needs to execute tools on web pages via navigator.modelContext.
---

# Browser Control

Control Chrome browser tabs and execute page tools via WebSocket communication with the browser extension.

## Quick Start

1. Start the bridge server:
```bash
node /path/to/browser-mcp/skills/browser-control/scripts/ws-server.js &
```

2. Wait for extension connection:
```bash
sleep 2
curl -s localhost:8766/status
```

3. Use the HTTP API to control the browser.

## HTTP API Reference

The bridge server exposes a REST API on port 8766.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Connection status and browser info |
| `/tabs` | GET | List all tabs with their tools |
| `/tabs` | POST | Open new tab (`{"url": "..."}`) |
| `/tabs/:id` | DELETE | Close a tab |
| `/tabs/:id/tools` | GET | Discover tools for a specific tab |
| `/tabs/:id/tools/:name` | POST | Call a tool (`{"args": {...}}`) |

## Common Operations

### Check Connection Status

```bash
curl -s localhost:8766/status
```

Response:
```json
{
  "connected": true,
  "browser": {"name": "Chrome", "version": "120.0"},
  "tabCount": 3
}
```

### List All Tabs

```bash
curl -s localhost:8766/tabs
```

Response:
```json
{
  "tabs": [
    {"id": 1, "title": "Example", "url": "https://example.com", "tools": [...]},
    {"id": 2, "title": "Google", "url": "https://google.com", "tools": [...]}
  ]
}
```

### Open a New Tab

```bash
curl -s -X POST localhost:8766/tabs \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

Response:
```json
{
  "tab": {"id": 3, "title": "Example", "url": "https://example.com", "tools": []}
}
```

### Close a Tab

```bash
curl -s -X DELETE localhost:8766/tabs/3
```

### Discover Tools on a Tab

```bash
curl -s localhost:8766/tabs/1/tools
```

Response:
```json
{
  "tools": [
    {
      "name": "search",
      "description": "Search the page",
      "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}}
    }
  ]
}
```

### Call a Page Tool

```bash
curl -s -X POST localhost:8766/tabs/1/tools/search \
  -H "Content-Type: application/json" \
  -d '{"query": "example search"}'
```

Response:
```json
{
  "result": {"matches": ["Result 1", "Result 2"]}
}
```

## Architecture

```
Claude (curl) ──→ HTTP API (8766) ──→ ws-server.js ──→ WebSocket (8765) ──→ Extension ──→ Page
```

The bridge server:
1. Listens for HTTP requests from Claude on port 8766
2. Maintains a WebSocket connection to the browser extension
3. Translates HTTP requests to WebSocket messages
4. Returns responses as JSON

## Extension Discovery

The server writes a discovery file to `/tmp/browser-mcp/server-{pid}.json` containing the WebSocket port. The browser extension monitors this directory and auto-connects.

## Error Handling

All endpoints return errors as:
```json
{
  "error": "Error message here"
}
```

Common errors:
- `Extension not connected` - Browser extension hasn't connected yet
- `Tab not found` - Invalid tab ID
- `Tool not found` - Tool doesn't exist on the page
- `Tool execution failed` - Page tool returned an error

## Session Lifecycle

1. Start the server: `node ws-server.js &`
2. Extension auto-connects when it detects the discovery file
3. Use HTTP API to control browser
4. Kill server when done: `pkill -f ws-server.js`

## References

For detailed protocol information, see:
- `references/message-protocol.md` - Full WebSocket message format
- `examples/` - Complete usage examples
