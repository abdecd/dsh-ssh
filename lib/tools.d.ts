export declare function registerTools(ctx: any): () => void;
/**
 * Configure AI tools for remote workspace sessions only.
 * Non-remote workspaces will not have remote_ssh_* tools injected into their prompt/runtime.
 */
export declare function setupRemoteTools(ctx: any): () => void;
