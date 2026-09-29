import { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-ssh";
export declare const inject: string[];
export * from './config';
export * from './workspace';
export * from './connection';
export * from './timeout';
export * from './interceptor';
export * from './tools';
export * from './terminal';
export declare function apply(ctx: Context): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
