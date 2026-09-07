/**
 * CSRF / Origin & Port validation for HTTP endpoints.
 * Strictly enforces protocol, host, and port matching against Host header.
 * Eliminates cross-origin and cross-port CSRF risks from localhost or external domains.
 */
export declare function isSafeRequest(req: any): boolean;
export declare function registerFsInterceptors(ctx: any): void;
