# Browser MCP Server - Design Specification

An MCP server that connects to Chrome and dynamically exposes per-tab tools to Claude Code.

---

## Core Concept

- Tools change based on server state (connected/disconnected, focused tab)
- Only the focused tab's tools are in context - other tabs are "sheltered"
- `listChanged` notifications trigger Claude Code to re-fetch tools
- Explicit tab model - Claude knows it's working with tabs and can reason about them

---

## State Machine

```
┌─────────────────┐
│   DISCONNECTED  │  tools: [connect_browser]
└────────┬────────┘
         │ connect_browser() → emits listChanged
         │ (connect_browser disappears)
         ▼
┌─────────────────┐
│   CONNECTED     │  tools: [list_tabs, open_tab]
│   (no tabs)     │
└────────┬────────┘
         │ open_tab(url, focus=true) → emits listChanged
         ▼
┌─────────────────┐
│   CONNECTED     │  tools: [list_tabs, open_tab, focus_tab]
│   (tabs exist,  │  (focus_tab appears when there's something to focus)
│   none focused) │
└────────┬────────┘
         │ focus_tab(tabId) → emits listChanged
         ▼
┌─────────────────┐
│   TAB FOCUSED   │  tools: [list_tabs, open_tab, focus_tab, close_tab,
└────────┬────────┘          + <page-specific dynamic tools>]
         │
         ├─── focus_tab(differentId) → emits listChanged ───┐
         │                                                   │
         │                                                   ▼
         │                                        ┌─────────────────┐
         │                                        │  NEW TAB        │
         │                                        │  FOCUSED        │
         │                                        └────────┬────────┘
         │                                                 │
         │◄────────────────────────────────────────────────┘
         │
         ├─── close_tab() on last tab → emits listChanged ──────────────┐
         │                                                               │
         │ close_tab() on focused tab (other tabs remain)                │
         │ → emits listChanged                                           │
         ▼                                                               │
┌─────────────────┐                                                      │
│   CONNECTED     │  tools: [list_tabs, open_tab, focus_tab]             │
│   (tabs exist,  │  (must call focus_tab to select a tab)               │
│   none focused) │                                                      │
└─────────────────┘                                                      │
                                                                         │
         ┌───────────────────────────────────────────────────────────────┘
         ▼
┌─────────────────┐
│   CONNECTED     │  tools: [list_tabs, open_tab]
│   (no tabs)     │
└─────────────────┘
```

---

## Tool Availability by State

| State | Tools Available |
|-------|-----------------|
| **DISCONNECTED** | `connect_browser` |
| **CONNECTED (no tabs)** | `list_tabs`, `open_tab` |
| **CONNECTED (tabs, no focus)** | `list_tabs`, `open_tab`, `focus_tab` |
| **TAB FOCUSED** | `list_tabs`, `open_tab`, `focus_tab`, `close_tab`, + page-specific tools |

---

## Core Tools

### `connect_browser`

**Available**: DISCONNECTED state only

**Purpose**: Establish connection to browser (attach to existing or launch new)

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "launch": {
      "type": "boolean",
      "description": "Launch new browser instance if none found",
      "default": false
    }
  }
}
```

**Response** (success):
```json
{
  "connected": true,
  "browser": {
    "name": "Chrome",
    "version": "120.0.0"
  },
  "tabCount": 3
}
```

**Response** (no browser found):
```json
{
  "connected": false,
  "error": "No browser found",
  "instructions": "Please open Chrome with the Browser Tools extension enabled, or call with launch=true"
}
```

**Side effects**:
- Emits `listChanged` on success
- `connect_browser` disappears from tool list
- `list_tabs`, `open_tab` appear

---

### `list_tabs`

**Available**: CONNECTED states

**Purpose**: See all open tabs without loading their tools

**Input Schema**:
```json
{
  "type": "object",
  "properties": {}
}
```

**Response**:
```json
{
  "tabs": [
    {
      "id": 123456789,
      "title": "Inbox (3) - Gmail",
      "url": "https://mail.google.com/mail/u/0/#inbox",
      "focused": false,
      "toolCount": 12
    },
    {
      "id": 987654321,
      "title": "Flights - Expedia",
      "url": "https://www.expedia.com/Flights",
      "focused": true,
      "toolCount": 8
    },
    {
      "id": 456789123,
      "title": "GitHub",
      "url": "https://github.com",
      "focused": false,
      "toolCount": 15
    }
  ],
  "focusedTabId": 987654321
}
```

**Notes**:
- `toolCount` helps Claude decide whether to focus a tab
- `focused: true` indicates which tab's tools are currently loaded
- `focusedTabId` is `null` if no tab is focused

---

### `open_tab`

**Available**: CONNECTED states

**Purpose**: Open a new browser tab

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "URL to open"
    },
    "focus": {
      "type": "boolean",
      "description": "Focus the new tab after opening",
      "default": true
    }
  },
  "required": ["url"]
}
```

**Response**:
```json
{
  "tab": {
    "id": 111222333,
    "title": "Loading...",
    "url": "https://example.com"
  },
  "focused": true,
  "toolsAvailable": ["click_button", "fill_form", "get_page_content"]
}
```

**Side effects**:
- If `focus=true`: Emits `listChanged`, page tools appear
- If `focus=false`: No `listChanged`, just adds to `list_tabs()`

---

### `focus_tab`

**Available**: When tabs exist

**Purpose**: Switch focus to a different tab, loading its tools

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "tabId": {
      "type": "number",
      "description": "ID of the tab to focus"
    }
  },
  "required": ["tabId"]
}
```

**Response**:
```json
{
  "success": true,
  "tab": {
    "id": 123456789,
    "title": "Inbox (3) - Gmail",
    "url": "https://mail.google.com/mail/u/0/#inbox"
  },
  "toolsAvailable": [
    "compose_email",
    "search_inbox",
    "open_thread",
    "archive_selected",
    "mark_as_read",
    "delete_selected"
  ]
}
```

**Side effects**:
- Emits `listChanged`
- Previous tab's tools disappear
- New tab's tools appear

---

### `close_tab`

**Available**: TAB FOCUSED state

**Purpose**: Close a tab

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "tabId": {
      "type": "number",
      "description": "ID of tab to close. Defaults to focused tab."
    }
  }
}
```

**Response**:
```json
{
  "closed": true,
  "tabId": 123456789
}
```

**Side effects**:
- If closing focused tab: Emits `listChanged`, returns to CONNECTED (tabs exist, none focused) state. Page-specific tools disappear. Claude must call `focus_tab` to select another tab.
- If closing non-focused tab: No `listChanged`, no state change
- If closing last tab: Returns to CONNECTED (no tabs) state

---

## Dynamic Page Tools

When a tab is focused, page-specific tools are discovered via introspection and added to the tool list. These tools:

- Have no tab prefix (they implicitly operate on focused tab)
- Appear/disappear when focus changes
- Are generated by analyzing the page DOM

### Example: Gmail Inbox

When focused on Gmail, these tools might appear:

```json
[
  {
    "name": "compose_email",
    "description": "Open the compose window to write a new email",
    "inputSchema": {
      "type": "object",
      "properties": {
        "to": { "type": "string", "description": "Recipient email" },
        "subject": { "type": "string" },
        "body": { "type": "string" }
      }
    }
  },
  {
    "name": "search_inbox",
    "description": "Search emails in inbox",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Search query" }
      },
      "required": ["query"]
    }
  },
  {
    "name": "open_thread",
    "description": "Open an email thread by index",
    "inputSchema": {
      "type": "object",
      "properties": {
        "index": { "type": "number", "description": "Thread index (0-based)" }
      },
      "required": ["index"]
    }
  }
]
```

### Example: Expedia Flights

When focused on Expedia flight search:

```json
[
  {
    "name": "search_flights",
    "description": "Search for flights",
    "inputSchema": {
      "type": "object",
      "properties": {
        "from": { "type": "string", "description": "Departure airport code" },
        "to": { "type": "string", "description": "Arrival airport code" },
        "departDate": { "type": "string", "format": "date" },
        "returnDate": { "type": "string", "format": "date" },
        "passengers": { "type": "number", "default": 1 }
      },
      "required": ["from", "to", "departDate"]
    }
  },
  {
    "name": "select_flight",
    "description": "Select a flight from search results",
    "inputSchema": {
      "type": "object",
      "properties": {
        "index": { "type": "number", "description": "Flight result index" }
      },
      "required": ["index"]
    }
  }
]
```

---

## Example Workflows

### Single Tab Workflow

```
User: "Go to GitHub and star the anthropics/claude-code repo"

[State: DISCONNECTED]
Claude: calls connect_browser()
        → success, emits listChanged

[State: CONNECTED (no tabs)]
Claude: calls open_tab("https://github.com/anthropics/claude-code", focus=true)
        → opens tab, emits listChanged

[State: TAB FOCUSED - GitHub repo page]
Tools now include: star_repo, fork_repo, watch_repo, view_issues...

Claude: calls star_repo()
        → done

Claude: "I've starred the anthropics/claude-code repository."
```

### Multi-Tab Comparison

```
User: "Compare flight prices on Expedia and Kayak for SFO to NYC next Friday"

[State: CONNECTED, Expedia tab focused]
Claude: calls search_flights(from: "SFO", to: "NYC", date: "2024-01-19")
        → result: $450

Claude: calls list_tabs()
        → sees Kayak tab exists

Claude: calls focus_tab(kayakTabId)
        → emits listChanged, Kayak tools appear

[State: TAB FOCUSED - Kayak]
Claude: calls search_flights(from: "SFO", to: "NYC", date: "2024-01-19")
        → result: $520

Claude: "I compared both sites:
        - Expedia: $450
        - Kayak: $520
        Expedia has the better price by $70."
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Claude Code                           │
│                                                              │
│  Sees tools based on server state:                          │
│  - DISCONNECTED: [connect_browser]                          │
│  - CONNECTED: [list_tabs, open_tab, ...]                    │
│  - FOCUSED: [core tools + page-specific tools]              │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │ MCP (stdio)
                           │
                           │ tools/list ──────► returns current tools
                           │ tools/call ──────► executes tool
                           │ ◄── notifications/tools/list_changed
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Browser MCP Server                        │
│                                                              │
│  State:                                                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ connected: boolean                                   │    │
│  │ focusedTabId: number | null                         │    │
│  │ tabs: Map<number, {                                 │    │
│  │   id: number                                        │    │
│  │   title: string                                     │    │
│  │   url: string                                       │    │
│  │   tools: Tool[]  // discovered via introspection    │    │
│  │ }>                                                  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  getTools(): Tool[]                                         │
│  ─────────────────                                          │
│  if (!connected) return [connect_browser]                   │
│  if (tabs.size === 0) return [list_tabs, open_tab]          │
│  if (!focusedTabId) return [list_tabs, open_tab, focus_tab] │
│  return [core_tools] + tabs.get(focusedTabId).tools         │
│                                                              │
│                                                              │
│  WebSocket Server: ws://localhost:8765                       │
│  (Extension connects here as client)                         │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket
                           │
                           │ Extension connects on load
                           │ ◄─────────────────────────────────
                           │
                           │ ping (every 20s, keeps SW alive)
                           │ ◄─────────────────────────────────
                           │ ─────────────────────────────────► pong
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Chrome Extension (MV3 Service Worker)           │
│                                                              │
│  Connects to MCP server's WebSocket on startup               │
│  Sends keepalive ping every 20s (Chrome MV3 requirement)     │
│                                                              │
│  Responsibilities:                                           │
│  - Report open tabs on connection                           │
│  - Introspect focused page → generate tool definitions      │
│  - Execute tool actions (click, fill, etc.)                 │
│  - Notify on tab open/close/navigate                        │
└─────────────────────────────────────────────────────────────┘
```

### WebSocket Protocol

**Extension → MCP Server:**
```typescript
| { type: "ping" }                                              // Keepalive (every 20s)
| { type: "connected"; browser: {...}; tabs: TabInfo[] }        // Response to "connect"
| { type: "disconnected" }                                      // Browser closing
| { type: "tabCreated"; tab: TabInfo }                          // New tab opened
| { type: "tabUpdated"; tab: TabInfo }                          // Tab title/url changed
| { type: "tabClosed"; tabId: number }                          // Tab closed
| { type: "tabFocused"; tabId: number; tools: Tool[] }          // Tab focused + its tools
| { type: "toolsChanged"; tabId: number; tools: Tool[] }        // Page tools changed
| { type: "toolResult"; callId: string; result: any; error?: string }
```

**MCP Server → Extension:**
```typescript
| { type: "pong" }                                              // Keepalive response
| { type: "connect"; launch?: boolean }                         // Request browser info
| { type: "openTab"; url: string; focus: boolean }              // Open new tab
| { type: "focusTab"; tabId: number }                           // Focus existing tab
| { type: "closeTab"; tabId: number }                           // Close tab
| { type: "callTool"; callId: string; tabId: number; toolName: string; args: object }
```

---

## Edge Cases

| Scenario | Server Behavior |
|----------|-----------------|
| Extension connects to WebSocket | Ready for `connect_browser` call |
| Extension disconnects | Reset to DISCONNECTED state, emit `listChanged` |
| User closes focused tab in browser | Emit `listChanged`, set `focusedTabId = null`, page tools disappear |
| User opens new tab in browser | Add to tabs map, no `listChanged` (unfocused) |
| User switches tab in browser | Optional: track and emit `listChanged` (configurable) |
| Page navigates (same tab) | Re-introspect, emit `listChanged` if tools changed |
| Tab crashes | Remove from tabs, emit `listChanged` if was focused |
| `focus_tab` with invalid ID | Return error, no state change |
| `open_tab` with invalid URL | Return error, no state change |

---

## Implementation Notes

### MCP Server Setup

```typescript
const server = new McpServer({
  name: "browser",
  version: "1.0.0"
});

server.setCapabilities({
  tools: { listChanged: true }
});
```

### Emitting listChanged

```typescript
function emitToolsChanged() {
  server.notification({
    method: "notifications/tools/list_changed"
  });
}
```

### Dynamic Tool List

```typescript
server.setRequestHandler("tools/list", async () => {
  return { tools: getToolsForCurrentState() };
});

function getToolsForCurrentState(): Tool[] {
  if (!state.connected) {
    return [connectBrowserTool];
  }

  if (state.tabs.size === 0) {
    return [listTabsTool, openTabTool];
  }

  if (!state.focusedTabId) {
    return [listTabsTool, openTabTool, focusTabTool];
  }

  const focusedTab = state.tabs.get(state.focusedTabId);
  return [
    listTabsTool,
    openTabTool,
    focusTabTool,
    closeTabTool,
    ...focusedTab.tools  // page-specific tools
  ];
}
```

---

## Summary

- **Single entry point**: `connect_browser` is the only tool initially
- **Progressive disclosure**: Tools appear as state changes
- **Explicit tab model**: Claude calls `focus_tab` to load a tab's tools
- **Minimal context**: Only focused tab's tools in context at any time
- **listChanged**: Drives all tool visibility changes
- **MCP server hosts WebSocket**: Extension connects as client to `ws://localhost:8765`
- **MV3 compatible**: Extension sends ping every 20s to keep service worker alive
