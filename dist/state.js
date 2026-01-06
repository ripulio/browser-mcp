/**
 * Browser State - Shared State Management
 *
 * This module maintains the shared browser state that all sessions access.
 * Since there's only one browser with one set of tabs, this state is shared
 * across all MCP client sessions.
 *
 * State includes:
 * - Connection status (connected/disconnected)
 * - Browser info (name, version)
 * - Map of open tabs with their IDs, titles, URLs, and available tools
 *
 * Operations that modify individual tab state (add, update, remove, tools)
 * are performed here, while session-specific pending operations are tracked
 * separately in session.ts.
 */
function createInitialState() {
    return {
        connected: false,
        tabs: new Map(),
        browserInfo: null,
    };
}
// Singleton shared state
const sharedState = createInitialState();
export function getState() {
    return sharedState;
}
export function setConnected(connected, browserInfo) {
    sharedState.connected = connected;
    sharedState.browserInfo = browserInfo ?? null;
    if (!connected) {
        sharedState.tabs.clear();
    }
}
export function addTab(tab) {
    sharedState.tabs.set(tab.id, tab);
}
export function updateTab(tab) {
    sharedState.tabs.set(tab.id, tab);
}
export function removeTab(tabId) {
    sharedState.tabs.delete(tabId);
}
export function updateTabTools(tabId, tools) {
    const tab = sharedState.tabs.get(tabId);
    if (tab) {
        tab.tools = tools;
    }
}
export function isConnected() {
    return sharedState.connected;
}
