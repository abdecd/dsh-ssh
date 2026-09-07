export interface SshRunResult {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: string;
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
export declare function shellQuote(p: string): string;
/**
 * Execute a command on remote host via OpenSSH CLI with ControlMaster socket multiplexing.
 */
export declare function runSsh(host: string, command: string, stdinData?: string | Buffer, timeoutMs?: number): Promise<SshRunResult>;
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
 * Atomically write content to a remote file.
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
 */
export declare function testSshConnection(host: string, password?: string): Promise<{
    ok: boolean;
    message: string;
}>;
