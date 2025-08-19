import { EventEmitter } from 'events';
import { SIPAdvancedConfig, SIPProviderProfile } from './types.js';
import { getLogger } from './logger.js';

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
  on<U extends keyof ConnectionEvents>(
    event: U, listener: ConnectionEvents[U]
  ): this;
  
  emit<U extends keyof ConnectionEvents>(
    event: U, ...args: Parameters<ConnectionEvents[U]>
  ): boolean;
}

export class ConnectionManager extends EventEmitter {
  private state: ConnectionState;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private config: SIPAdvancedConfig;

  constructor(config: SIPAdvancedConfig) {
    super();
    this.config = config;
    this.state = {
      status: 'disconnected',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      transportFallbackIndex: 0,
      providerProfile: config._providerProfile
    };
  }

  get currentState(): ConnectionState {
    return { ...this.state };
  }

  async connect(sipClient: any): Promise<void> {
    getLogger().sip.info('ConnectionManager: Starting connection...');
    this.state.status = 'connecting';
    this.emit('stateChange', this.state);
    
    try {
      await sipClient.connect();
      this.onConnectionSuccess();
    } catch (error) {
      this.onConnectionError(error);
    }
  }

  onRegistered(): void {
    getLogger().sip.info('ConnectionManager: SIP client registered');
    this.state.status = 'registered';
    this.emit('stateChange', this.state);
    this.emit('registered');
  }

  onDisconnected(): void {
    getLogger().sip.info('ConnectionManager: SIP client disconnected');
    const wasRegistered = this.state.status === 'registered';
    this.state.status = 'disconnected';
    this.emit('stateChange', this.state);

    // If we were registered and got disconnected unexpectedly, try to reconnect
    if (wasRegistered && this.shouldReconnect()) {
      getLogger().sip.warn('ConnectionManager: Unexpected disconnection, attempting reconnect...');
      this.scheduleReconnect();
    }
  }

  private onConnectionSuccess(): void {
    getLogger().sip.info('ConnectionManager: Connection successful');
    this.state = {
      ...this.state,
      status: 'connected',
      lastConnected: new Date(),
      reconnectAttempts: 0,
      transportFallbackIndex: 0,
      lastError: undefined
    };
    
    this.emit('stateChange', this.state);
    this.emit('connected');
    this.stopReconnectTimer();
  }

  private onConnectionError(error: any): void {
    getLogger().sip.error(`ConnectionManager: Connection failed: ${error.message}`);
    this.state.lastError = error;
    
    // Try provider-specific error handling first
    if (this.handleProviderSpecificError(error)) {
      getLogger().sip.info('ConnectionManager: Provider-specific error handling applied, retrying...');
      this.scheduleReconnect();
      return;
    }
    
    // Try transport fallback
    if (this.tryTransportFallback()) {
      return; // Will retry with different transport
    }
    
    // Try reconnection with backoff
    if (this.shouldReconnect()) {
      this.scheduleReconnect();
    } else {
      this.state.status = 'failed';
      this.emit('stateChange', this.state);
      this.emit('connectionFailed', error);
    }
  }

  private tryTransportFallback(): boolean {
    const transports = this.config.preferredTransports || ['udp'];
    
    if (this.state.transportFallbackIndex < transports.length - 1) {
      this.state.transportFallbackIndex++;
      this.state.currentTransport = transports[this.state.transportFallbackIndex];
      
      getLogger().sip.debug(`ConnectionManager: Trying transport fallback to ${this.state.currentTransport}`);
      this.emit('transportFallback', this.state.currentTransport);
      
      // Update config for next connection attempt
      this.updateConfigForTransportFallback();
      
      this.scheduleReconnect();
      return true;
    }
    
    getLogger().sip.error('ConnectionManager: All transports exhausted');
    return false;
  }

  private updateConfigForTransportFallback(): void {
    if (!this.state.currentTransport) return;

    // Move the current transport to the front of the list
    const transports = this.config.preferredTransports || ['udp'];
    const currentTransport = this.state.currentTransport;
    
    this.config.preferredTransports = [
      currentTransport,
      ...transports.filter(t => t !== currentTransport)
    ] as any;
    
    getLogger().sip.debug(`ConnectionManager: Updated transport preference to ${this.config.preferredTransports?.join(' → ') || 'default'}`);
  }

  private shouldReconnect(): boolean {
    return this.state.reconnectAttempts < this.state.maxReconnectAttempts;
  }

  private scheduleReconnect(): void {
    const backoffDelay = Math.min(
      1000 * Math.pow(2, this.state.reconnectAttempts), 
      30000 // Max 30 second delay
    );
    
    this.state.reconnectAttempts++;
    
    getLogger().sip.debug(
      `ConnectionManager: Scheduling reconnect attempt ${this.state.reconnectAttempts}/${this.state.maxReconnectAttempts} in ${backoffDelay}ms`
    );
    
    this.reconnectTimer = setTimeout(() => {
      this.emit('reconnectAttempt', this.state.reconnectAttempts);
    }, backoffDelay);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleProviderSpecificError(error: any): boolean {
    const providerId = this.state.providerProfile?.name?.toLowerCase().replace(/\s+/g, '-');
    if (!providerId) return false;
    
    switch (providerId) {
      case 'asterisk':
      case 'asterisk-pbx':
        return this.handleAsteriskError(error);
      case 'cisco':
      case 'cisco-unified-communications-manager-cucm':
        return this.handleCiscoError(error);
      case 'avm-fritz-box':
      case 'fritz-box':
        return this.handleFritzBoxError(error);
      default:
        return false;
    }
  }

  private handleAsteriskError(error: any): boolean {
    // Asterisk-specific error patterns and recovery
    if (error.message?.includes('Session-Expires too small')) {
      getLogger().sip.debug('ConnectionManager: Asterisk requires longer session timers, adjusting...');
      if (this.config.sessionTimers) {
        this.config.sessionTimers.expires = Math.max(this.config.sessionTimers.expires || 1800, 1800);
      }
      return true; // Retry with adjusted config
    }
    
    if (error.code === 488 && error.message?.includes('codec')) {
      getLogger().sip.debug('ConnectionManager: Asterisk rejected our codec offer, trying G.711 only...');
      // Temporarily disable G.722 for this connection
      if (this.config.audio) {
        this.config.audio.preferredCodecs = [0, 8]; // G.711 only
      }
      return true;
    }
    
    if (error.message?.includes('STUN') || error.code === 408) {
      getLogger().sip.debug('ConnectionManager: Asterisk connection timeout, adding STUN servers...');
      if (!this.config.stunServers?.length) {
        this.config.stunServers = ['stun:stun.l.google.com:19302'];
      }
      return true;
    }
    
    return false;
  }

  private handleCiscoError(error: any): boolean {
    // Cisco-specific error handling
    if (error.code === 420 && error.message?.includes('Bad Extension')) {
      getLogger().sip.debug('ConnectionManager: Cisco requires PRACK support, enabling...');
      this.config.prackSupport = 'required';
      return true;
    }
    
    if (error.message?.includes('transport') || error.message?.includes('TCP')) {
      getLogger().sip.debug('ConnectionManager: Cisco prefers TCP, switching transport...');
      this.config.preferredTransports = ['tcp', 'udp'] as any;
      return true;
    }
    
    if (error.code === 401 && this.state.reconnectAttempts === 0) {
      getLogger().sip.debug('ConnectionManager: Cisco authentication challenge, retrying...');
      return true;
    }
    
    return false;
  }

  private handleFritzBoxError(error: any): boolean {
    // Fritz Box typically works with basic settings
    if (error.message?.includes('STUN')) {
      getLogger().sip.debug('ConnectionManager: Fritz Box doesn\'t need STUN, disabling for retry...');
      this.config.stunServers = [];
      return true;
    }
    
    if (error.message?.includes('session timer') || error.message?.includes('Session-Expires')) {
      getLogger().sip.debug('ConnectionManager: Fritz Box doesn\'t support session timers, disabling...');
      if (this.config.sessionTimers) {
        this.config.sessionTimers.enabled = false;
      }
      return true;
    }
    
    if (error.message?.includes('transport') && this.config.preferredTransports?.includes('tcp')) {
      getLogger().sip.debug('ConnectionManager: Fritz Box prefers UDP, switching transport...');
      this.config.preferredTransports = ['udp'] as any;
      return true;
    }
    
    return false;
  }

  public forceReconnect(): void {
    getLogger().sip.debug('ConnectionManager: Force reconnect requested');
    this.state.reconnectAttempts = 0;
    this.state.transportFallbackIndex = 0;
    this.scheduleReconnect();
  }

  public resetConnection(): void {
    getLogger().sip.debug('ConnectionManager: Reset connection state');
    this.stopReconnectTimer();
    this.state = {
      status: 'disconnected',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      transportFallbackIndex: 0,
      providerProfile: this.config._providerProfile
    };
    this.emit('stateChange', this.state);
  }

  public updateConfig(newConfig: SIPAdvancedConfig): void {
    getLogger().sip.debug('ConnectionManager: Configuration updated');
    this.config = newConfig;
    this.state.providerProfile = newConfig._providerProfile;
  }

  public destroy(): void {
    getLogger().sip.debug('ConnectionManager: Destroying connection manager');
    this.stopReconnectTimer();
    this.removeAllListeners();
  }
}