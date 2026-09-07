export interface SshHostEntry {
    host: string;
    hostName?: string;
    user?: string;
    port?: number;
    identityFile?: string;
    proxyJump?: string;
    passwordAuthentication?: boolean;
}
/**
 * Parse ~/.ssh/config and extract valid Host entries.
 * Skips wildcard entries (*, ?).
 */
export declare function parseSshConfig(customPath?: string): SshHostEntry[];
