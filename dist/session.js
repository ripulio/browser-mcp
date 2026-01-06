/**
 * Session Management - Multi-Client Support
 *
 * This module provides session tracking for multiple concurrent MCP clients.
 * Each Claude instance gets its own session with isolated pending operations,
 * while sharing the same underlying browser state.
 *
 * Key features:
 * - Session creation and lifecycle management
 * - Per-session tracking of pending calls, tab operations, and connect requests
 * - Automatic cleanup of inactive sessions (30-minute timeout)
 * - Call ID generation with embedded session IDs for response routing
 *
 * This enables multiple Claude tabs to control the same browser simultaneously
 * without interfering with each other's pending operations.
 */
const sessions = new Map();
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
export function createSession(sessionId) {
    const session = {
        id: sessionId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        callIdCounter: 0,
        pendingCalls: new Map(),
        pendingOpenTabs: new Map(),
        pendingCloseTabs: new Map(),
        pendingConnect: null,
        connectInProgress: false,
    };
    sessions.set(sessionId, session);
    console.error(`Session created: ${sessionId}`);
    return session;
}
export function getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
        session.lastActivityAt = Date.now();
    }
    return session;
}
export function getOrCreateSession(sessionId) {
    let session = sessions.get(sessionId);
    if (!session) {
        session = createSession(sessionId);
    }
    else {
        session.lastActivityAt = Date.now();
    }
    return session;
}
export function deleteSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session)
        return;
    // Reject all pending calls
    for (const [callId, pending] of session.pendingCalls) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Session closed"));
    }
    session.pendingCalls.clear();
    // Reject all pending open tab operations
    for (const [requestId, pending] of session.pendingOpenTabs) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Session closed"));
    }
    session.pendingOpenTabs.clear();
    // Reject all pending close tab operations
    for (const [tabId, pending] of session.pendingCloseTabs) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Session closed"));
    }
    session.pendingCloseTabs.clear();
    // Reject pending connect
    if (session.pendingConnect) {
        clearTimeout(session.pendingConnect.timeout);
        session.pendingConnect.reject(new Error("Session closed"));
        session.pendingConnect = null;
    }
    sessions.delete(sessionId);
    console.error(`Session deleted: ${sessionId}`);
}
export function getAllSessions() {
    return Array.from(sessions.values());
}
export function cleanupInactiveSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [sessionId, session] of sessions) {
        if (now - session.lastActivityAt > SESSION_TIMEOUT_MS) {
            console.error(`Cleaning up inactive session: ${sessionId}`);
            deleteSession(sessionId);
            cleanedCount++;
        }
    }
    return cleanedCount;
}
let cleanupInterval = null;
export function startSessionCleanup() {
    if (cleanupInterval)
        return;
    cleanupInterval = setInterval(() => {
        const cleaned = cleanupInactiveSessions();
        if (cleaned > 0) {
            console.error(`Cleaned up ${cleaned} inactive session(s)`);
        }
    }, CLEANUP_INTERVAL_MS);
}
export function stopSessionCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}
// Helper to generate unique call IDs per session
export function generateCallId(session, prefix = "call") {
    return `${session.id}_${prefix}_${++session.callIdCounter}`;
}
// Helper to extract session ID from a namespaced call ID
export function extractSessionIdFromCallId(callId) {
    const parts = callId.split("_");
    if (parts.length >= 3) {
        // Format: sessionId_prefix_counter
        // sessionId might contain underscores, so we need to find the prefix
        const lastUnderscoreIndex = callId.lastIndexOf("_");
        const secondLastUnderscoreIndex = callId.lastIndexOf("_", lastUnderscoreIndex - 1);
        if (secondLastUnderscoreIndex > 0) {
            return callId.substring(0, secondLastUnderscoreIndex);
        }
    }
    return null;
}
