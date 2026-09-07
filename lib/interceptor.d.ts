/**
 * CSRF / Origin validation for HTTP endpoints.
 * Blocks cross-site malicious requests while allowing same-origin and local loopback clients.
 */
export declare function isSafeRequest(req: any): boolean;
export declare function registerFsInterceptors(ctx: any): void;
