export interface SshHostEntry {
    host: string;
    hostName?: string;
    user?: string;
    port?: number;
    identityFile?: string;
    proxyJump?: string;
}
/**
 * Parse ~/.ssh/config and extract valid Host entries.
 * Skips wildcard entries (*, ?).
 */
export declare function parseSshConfig(): SshHostEntry[];
