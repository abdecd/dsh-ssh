import React from 'react';
export declare function AddRemoteModal({ isOpen, onClose }: {
    isOpen: boolean;
    onClose: () => void;
}): React.ReactPortal | null;
export declare function ReAuthModal({ host, isOpen, onClose, onSuccess }: {
    host: string;
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}): React.ReactPortal | null;
export declare const inject: string[];
export declare function apply(_ctx: any): void;
