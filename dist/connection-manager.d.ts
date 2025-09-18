import { EventEmitter } from 'events';
import { SIPAdvancedConfig, SIPProviderProfile } from './types.js';
export interface ConnectionState {
    status: 'disconnected' | 'connecting' | 'connected' | 'registered' | 'failed';
    lastConnected?: Date;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    currentTransport?: string;
    transportFallbackIndex: number;
    providerProfile?: SIPProviderProfile;
    lastError?: any;
}
export interface ConnectionEvents {
    stateChange: (state: ConnectionState) => void;
    connectionFailed: (error: any) => void;
    transportFallback: (transport: string) => void;
    reconnectAttempt: (attempt: number) => void;
    connected: () => void;
    registered: () => void;
}
export declare interface ConnectionManager {
    on<U extends keyof ConnectionEvents>(event: U, listener: ConnectionEvents[U]): this;
    emit<U extends keyof ConnectionEvents>(event: U, ...args: Parameters<ConnectionEvents[U]>): boolean;
}
export declare class ConnectionManager extends EventEmitter {
    private state;
    private reconnectTimer;
    private config;
    constructor(config: SIPAdvancedConfig);
    get currentState(): ConnectionState;
    connect(sipClient: any): Promise<void>;
    onRegistered(): void;
    onDisconnected(): void;
    private onConnectionSuccess;
    private onConnectionError;
    private tryTransportFallback;
    private updateConfigForTransportFallback;
    private shouldReconnect;
    private scheduleReconnect;
    private stopReconnectTimer;
    private handleProviderSpecificError;
    private handleAsteriskError;
    private handleCiscoError;
    private handleFritzBoxError;
    forceReconnect(): void;
    resetConnection(): void;
    updateConfig(newConfig: SIPAdvancedConfig): void;
    destroy(): void;
}
//# sourceMappingURL=connection-manager.d.ts.map