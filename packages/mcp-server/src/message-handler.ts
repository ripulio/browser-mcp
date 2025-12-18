/**
 * Message Handler - Protocol Processing
 *
 * This module processes incoming messages from the browser extension and
 * updates application state accordingly. It handles the extension protocol:
 * - connected/disconnected: Browser connection state changes
 * - tabCreated/tabUpdated/tabClosed: Tab lifecycle events
 * - tabFocused: Tab focus with tool discovery
 * - toolsChanged/toolsDiscovered: Page tool availability updates
 * - toolResult: Results from executing page tools
 *
 * Messages are routed to the appropriate session based on sessionId or callId,
 * and pending promises are resolved/rejected as responses arrive.
 */

import { ExtensionMessage } from "./types.js";
import { ExtensionMessageType } from "./message-types.js";
import {
  setConnected,
  addTab,
  updateTab,
  removeTab,
  updateTabTools,
  getState,
} from "./state.js";
import {
  getSession,
  getAllSessions,
  extractSessionIdFromCallId,
  Session,
} from "./session.js";

const DEFAULT_SESSION_ID = "default";

export function rejectAllSessionPendingOps(session: Session, reason: string): void {
  for (const [, pending] of session.pendingCalls) {
    pending.reject(new Error(reason));
  }
  session.pendingCalls.clear();

  for (const [, pending] of session.pendingOpenTabs) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  session.pendingOpenTabs.clear();

  for (const [, pending] of session.pendingCloseTabs) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  session.pendingCloseTabs.clear();

  if (session.pendingConnect) {
    session.connectInProgress = false;
    clearTimeout(session.pendingConnect.timeout);
    session.pendingConnect.reject(new Error(reason));
    session.pendingConnect = null;
  }
}

export function handleExtensionMessage(message: ExtensionMessage): void {
  // Extract sessionId from message or callId
  let sessionId = (message as { sessionId?: string }).sessionId;

  // For messages with callId, extract sessionId from there
  if (!sessionId && "callId" in message) {
    sessionId = extractSessionIdFromCallId(message.callId) ?? DEFAULT_SESSION_ID;
  }

  // For messages with requestId, extract sessionId from there
  if (!sessionId && "requestId" in message && message.requestId) {
    sessionId = extractSessionIdFromCallId(message.requestId) ?? DEFAULT_SESSION_ID;
  }

  // Default to default session if no sessionId found
  if (!sessionId) {
    sessionId = DEFAULT_SESSION_ID;
  }

  switch (message.type) {
    case ExtensionMessageType.CONNECTED: {
      setConnected(true, message.browser);
      for (const tab of message.tabs) {
        addTab(tab);
      }
      // Resolve pending connect call for this session
      const session = getSession(sessionId);
      if (session?.pendingConnect) {
        session.connectInProgress = false;
        clearTimeout(session.pendingConnect.timeout);
        session.pendingConnect.resolve({
          name: message.browser.name,
          version: message.browser.version,
          tabCount: message.tabs.length,
        });
        session.pendingConnect = null;
      }
      break;
    }

    case ExtensionMessageType.DISCONNECTED:
      setConnected(false);
      break;

    case ExtensionMessageType.TAB_CREATED: {
      addTab(message.tab);
      // Resolve pending openTab call if requestId matches
      if (message.requestId) {
        const reqSessionId = extractSessionIdFromCallId(message.requestId) ?? sessionId;
        const session = getSession(reqSessionId);
        if (session) {
          const pending = session.pendingOpenTabs.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            session.pendingOpenTabs.delete(message.requestId);
            pending.resolve(message.tab);
          }
        }
      }
      break;
    }

    case ExtensionMessageType.TAB_UPDATED:
      updateTab(message.tab);
      break;

    case ExtensionMessageType.TAB_CLOSED: {
      removeTab(message.tabId);
      // Check all sessions for pending close operation
      for (const session of getAllSessions()) {
        const pending = session.pendingCloseTabs.get(message.tabId);
        if (pending) {
          clearTimeout(pending.timeout);
          session.pendingCloseTabs.delete(message.tabId);
          pending.resolve(undefined);
          break; // Only one session should be waiting for this close
        }
      }
      break;
    }

    case ExtensionMessageType.TOOLS_CHANGED:
      updateTabTools(message.tabId, message.tools);
      break;

    case ExtensionMessageType.TAB_FOCUSED: {
      updateTabTools(message.tabId, message.tools);
      // Resolve pending openTab if requestId matches
      if (message.requestId) {
        const reqSessionId = extractSessionIdFromCallId(message.requestId) ?? sessionId;
        const session = getSession(reqSessionId);
        if (session) {
          const pending = session.pendingOpenTabs.get(message.requestId);
          if (pending) {
            const tab = getState().tabs.get(message.tabId);
            if (tab) {
              clearTimeout(pending.timeout);
              session.pendingOpenTabs.delete(message.requestId);
              pending.resolve(tab);
            }
          }
        }
      }
      break;
    }

    case ExtensionMessageType.TOOLS_DISCOVERED: {
      const discoverSessionId = extractSessionIdFromCallId(message.callId) ?? sessionId;
      const session = getSession(discoverSessionId);
      if (session) {
        const pending = session.pendingCalls.get(message.callId);
        if (pending) {
          session.pendingCalls.delete(message.callId);
          updateTabTools(message.tabId, message.tools);
          pending.resolve(message.tools);
        }
      }
      break;
    }

    case ExtensionMessageType.TOOL_RESULT: {
      const resultSessionId = extractSessionIdFromCallId(message.callId) ?? sessionId;
      const session = getSession(resultSessionId);
      if (session) {
        const pending = session.pendingCalls.get(message.callId);
        if (pending) {
          session.pendingCalls.delete(message.callId);
          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.result);
          }
        }
      }
      break;
    }
  }
}

export function handleDisconnect(): void {
  setConnected(false);
  for (const session of getAllSessions()) {
    rejectAllSessionPendingOps(session, "Connection closed");
  }
}
