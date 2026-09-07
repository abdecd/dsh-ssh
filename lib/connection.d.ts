export interface SshRunResult {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: string;
    stdoutTruncated?: boolean;
}
export interface SshRunOptions {
    /** Use this password for this invocation without reading or mutating the cache. */
    password?: string;
    /** Do not use or create a ControlMaster connection. */
    disableConnectionReuse?: boolean;
    /** Restrict authentication to a direct password exchange. */
    passwordOnly?: boolean;
}
export interface FsEntry {
    name: string;
    path: string;
    isDir: boolean;
    isSymlink: boolean;
    broken: boolean;
    hidden: boolean;
}
export interface FsListing {
    path: string;
    entries: FsEntry[];
    truncated: boolean;
}
export interface FsReadResult {
    ok: boolean;
    kind?: 'text' | 'binary';
    content?: string;
    head?: string;
    size?: number;
    truncated?: boolean;
    error?: string;
}
export declare function setHostPassword(host: string, pass?: string): void;
export declare function getHostPassword(host: string): string | undefined;
export declare function hasHostPassword(host: string): boolean;
export declare function removeHostPassword(host: string): void;
/**
 * Gracefully close the OpenSSH ControlMaster connection for host,
 * and clear stored credentials.
 */
export declare function closeSshConnection(host: string): Promise<void>;
export declare function shellQuote(p: string): string;
/**
 * Generate a safe cd command that correctly expands ~ (tilde) to $HOME
 * while keeping all subpaths strictly POSIX shell quoted.
 */
export declare function shellCd(targetPath: string): string;
/**
 * Execute a command on remote host via OpenSSH CLI with ControlMaster socket multiplexing.
 */
export declare function runSsh(host: string, command: string, stdinData?: string | Buffer, timeoutMs?: number, options?: SshRunOptions): Promise<SshRunResult>;
export declare function invalidateCache(host?: string, remotePath?: string): void;
/**
 * List files in a remote directory. Formatted for dsh-better-sidebar.
 */
export declare function remoteListDir(host: string, remotePath: string, localDisplayPath: string): Promise<{
    ok: boolean;
    data?: FsListing;
    error?: string;
}>;
/**
 * Read text or binary content of a remote file.
 */
export declare function remoteReadFile(host: string, remotePath: string): Promise<FsReadResult>;
/**
 * Atomically write content to a remote file while strictly preserving file permissions.
 * Writes to a unique temp file with restrictive permissions (0600), applies original permissions
 * or safe defaults, and atomically renames via mv to avoid permission loosening or partial writes.
 */
export declare function remoteWriteFile(host: string, remotePath: string, content: string | Buffer): Promise<{
    ok: boolean;
    error?: string;
}>;
/**
 * Fast search in remote directory by file pattern / substring.
 */
export declare function remoteSearchFiles(host: string, remotePath: string, localDisplayPath: string, query: string): Promise<{
    ok: boolean;
    entries: Array<{
        path: string;
        isDir: boolean;
    }>;
    truncated: boolean;
    error?: string;
}>;
/**
 * Test SSH connection to host.
 *
 * A supplied password is deliberately scoped to this one connection attempt:
 * it is not written to the global cache until the caller has confirmed success.
 * Password attempts also bypass ControlMaster and all non-password methods so
 * an existing key or multiplexed session cannot make an incorrect password
 * appear valid.
 */
export declare function testSshConnection(host: string, password?: string): Promise<{
    ok: boolean;
    message: string;
}>;
export interface RemoteBrowseResult {
    ok: boolean;
    currentPath?: string;
    dirs?: string[];
    truncated?: boolean;
    error?: string;
}
/**
 * Safely browse remote directories for workspace creation folder picker.
 * Bounded to 200 directories and strips hidden folders.
 */
export declare function remoteBrowseDirs(host: string, targetPath?: string): Promise<RemoteBrowseResult>;
