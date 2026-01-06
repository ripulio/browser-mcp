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
import { Session } from "./session.js";
export declare function rejectAllSessionPendingOps(session: Session, reason: string): void;
export declare function handleExtensionMessage(message: ExtensionMessage): void;
export declare function handleDisconnect(): void;
