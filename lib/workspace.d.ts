export interface RemoteWorkspaceMeta {
    host: string;
    remotePath: string;
    title?: string;
    createdAt: number;
    authType?: 'key' | 'password';
}
export declare function getBaseDir(): string;
export declare function getWorkspacesDir(): string;
/**
 * Scan and resolve remote workspace metadata for a given path.
 * Strict security boundary:
 * Only workspaces managed by dsh-ssh in ~/.dsh/dsh-ssh/workspaces/<id> are recognized.
 * Unmanaged / arbitrary user project directories containing .remote-ssh.json are strictly ignored.
 */
export declare function findRemoteWorkspaceMeta(startPath?: string): {
    meta: RemoteWorkspaceMeta;
    anchorDir: string;
} | null;
/**
 * Translate a local path in the anchor workspace to the remote absolute path.
 * Hardened against path traversal attacks (../ escapes).
 * Throws on path traversal attempts outside workspace boundaries.
 */
export declare function localToRemotePath(localPath: string, anchorDir: string, remoteRoot: string): string;
/**
 * Create a new remote workspace anchor and register it into DSH workspaceRegistry.
 * Passwords are retained as a compatibility parameter but are never cached here;
 * callers must verify them before creating the workspace.
 */
export declare function createRemoteWorkspace(workspaceRegistry: any, host: string, remotePath: string, customTitle?: string, authType?: 'key' | 'password', password?: string): Promise<{
    ok: boolean;
    workspaceId?: string;
    anchorDir?: string;
    title?: string;
    error?: string;
}>;
/**
 * Delete a remote workspace anchor and unregister from DSH.
 * Strict whitelist enforcement: anchorDir must strictly reside under getWorkspacesDir()
 * and cannot be the workspaces directory itself.
 */
export declare function deleteRemoteWorkspace(workspaceRegistry: any, anchorDir: string): Promise<{
    ok: boolean;
    error?: string;
}>;
/**
 * Hook workspaceRegistry.delete to immediately delete the corresponding anchor directory
 * in ~/.dsh/dsh-ssh/workspaces/ when a workspace is removed.
 */
export declare function hookWorkspaceRegistryDeletion(ctx: any): void;
/**
 * Install the shell wrapper script for dsh-better-sidebar terminal integration.
 */
export declare function ensureShellWrapper(): void;
