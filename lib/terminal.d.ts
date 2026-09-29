/**
 * DSH's native terminal controller delegates terminal creation to the scoped
 * subprocess provider. Wrap that one operation only; ordinary subprocesses and
 * terminals outside managed remote anchors retain their original behavior.
 */
export declare function hookNativeTerminals(ctx: any): () => void;
