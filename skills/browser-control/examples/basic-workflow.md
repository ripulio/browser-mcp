# Basic Workflow Example

This example shows a complete workflow: starting the server, opening a tab, discovering tools, and calling a tool.

## 1. Start the Bridge Server

```bash
# Start in background
node /path/to/browser-mcp/skills/browser-control/scripts/ws-server.js &

# Wait for extension to connect
sleep 3
```

## 2. Check Connection Status

```bash
curl -s localhost:8766/status | jq
```

Expected output:
```json
{
  "connected": true,
  "browser": {
    "name": "Chrome",
    "version": "120.0.0.0"
  },
  "tabCount": 2
}
```

## 3. List Current Tabs

```bash
curl -s localhost:8766/tabs | jq
```

Expected output:
```json
{
  "tabs": [
    {
      "id": 1,
      "title": "New Tab",
      "url": "chrome://newtab/",
      "tools": []
    }
  ]
}
```

## 4. Open a New Tab

```bash
curl -s -X POST localhost:8766/tabs \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' | jq
```

Expected output:
```json
{
  "tab": {
    "id": 2,
    "title": "Example Domain",
    "url": "https://example.com/",
    "tools": []
  }
}
```

## 5. Discover Tools on a Tab

```bash
# Replace 2 with the actual tab ID from step 4
curl -s localhost:8766/tabs/2/tools | jq
```

Expected output (if page has tools):
```json
{
  "tools": [
    {
      "name": "get_page_content",
      "description": "Get the text content of the page",
      "inputSchema": {
        "type": "object",
        "properties": {}
      }
    }
  ]
}
```

## 6. Call a Tool

```bash
curl -s -X POST localhost:8766/tabs/2/tools/get_page_content \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

Expected output:
```json
{
  "result": {
    "content": "Example Domain\nThis domain is for use in illustrative examples..."
  }
}
```

## 7. Close the Tab

```bash
curl -s -X DELETE localhost:8766/tabs/2 | jq
```

Expected output:
```json
{
  "closed": true
}
```

## 8. Shutdown

```bash
# Kill the server
pkill -f ws-server.js
```

## Error Handling

If the extension isn't connected:
```bash
curl -s localhost:8766/tabs
```
```json
{
  "error": "Extension not connected"
}
```

If a tab doesn't exist:
```bash
curl -s localhost:8766/tabs/999/tools
```
```json
{
  "error": "Tab not found"
}
```
