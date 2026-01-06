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
import { TabInfo } from "./types.js";
export interface PendingCall {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
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
    resolve: (value: {
        name: string;
        version: string;
        tabCount: number;
    }) => void;
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
export declare function createSession(sessionId: string): Session;
export declare function getSession(sessionId: string): Session | undefined;
export declare function getOrCreateSession(sessionId: string): Session;
export declare function deleteSession(sessionId: string): void;
export declare function getAllSessions(): Session[];
export declare function cleanupInactiveSessions(): number;
export declare function startSessionCleanup(): void;
export declare function stopSessionCleanup(): void;
export declare function generateCallId(session: Session, prefix?: string): string;
export declare function extractSessionIdFromCallId(callId: string): string | null;
