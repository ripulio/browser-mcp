import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TabInfo } from "./types.js";

export interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface PendingOpenTabOperation {
  resolve: (value: TabInfo) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface PendingCloseTabOperation {
  resolve: (value?: void) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface PendingConnect {
  resolve: (value: { name: string; version: string; tabCount: number }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface Session {
  id: string;
  createdAt: number;
  lastActivityAt: number;
  callIdCounter: number;
  pendingCalls: Map<string, PendingCall>;
  pendingOpenTabs: Map<string, PendingOpenTabOperation>;
  pendingCloseTabs: Map<number, PendingCloseTabOperation>;
  pendingConnect: PendingConnect | null;
  connectInProgress: boolean;
}

const sessions = new Map<string, Session>();

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function createSession(sessionId: string): Session {
  const session: Session = {
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

export function getSession(sessionId: string): Session | undefined {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivityAt = Date.now();
  }
  return session;
}

export function getOrCreateSession(sessionId: string): Session {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession(sessionId);
  } else {
    session.lastActivityAt = Date.now();
  }
  return session;
}

export function deleteSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Reject all pending calls
  for (const [callId, pending] of session.pendingCalls) {
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

export function getAllSessions(): Session[] {
  return Array.from(sessions.values());
}

export function cleanupInactiveSessions(): number {
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

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startSessionCleanup(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const cleaned = cleanupInactiveSessions();
    if (cleaned > 0) {
      console.error(`Cleaned up ${cleaned} inactive session(s)`);
    }
  }, 60 * 1000); // Check every minute
}

export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Helper to generate unique call IDs per session
export function generateCallId(session: Session, prefix: string = "call"): string {
  return `${session.id}_${prefix}_${++session.callIdCounter}`;
}

// Helper to extract session ID from a namespaced call ID
export function extractSessionIdFromCallId(callId: string): string | null {
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
