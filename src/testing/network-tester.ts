import * as dgram from 'dgram';
import * as net from 'net';
import { SIPAdvancedConfig } from '../types.js';

export interface NetworkTestResult {
  sipServer: {
    reachable: boolean;
    latency?: number;
    error?: string;
    protocol?: string;
  };
  stunServers: Array<{
    server: string;
    reachable: boolean;
    error?: string;
    natType?: string;
  }>;
  recommendations: string[];
}

export class NetworkTester {
  private readonly DEFAULT_TIMEOUT = 5000; // 5 seconds

  async testNetworkConnectivity(config: SIPAdvancedConfig): Promise<NetworkTestResult> {
    const results: NetworkTestResult = {
      sipServer: { reachable: false },
      stunServers: [],
      recommendations: []
    };

    // Test SIP server connectivity
    await this.testSipServer(config, results);
    
    // Test STUN servers if configured
    if (config.stunServers?.length) {
      await this.testStunServers(config.stunServers, results);
    }

    // Generate recommendations
    this.generateRecommendations(results, config);

    return results;
  }

  private async testSipServer(config: SIPAdvancedConfig, results: NetworkTestResult): Promise<void> {
    const serverIp = config.serverIp;
    const serverPort = config.serverPort || 5060;
    
    console.log(`🔍 Testing SIP server connectivity: ${serverIp}:${serverPort}`);

    try {
      // Try UDP first (most common for SIP)
      const udpResult = await this.testUdpConnectivity(serverIp, serverPort);
      if (udpResult.reachable) {
        results.sipServer = {
          reachable: true,
          latency: udpResult.latency,
          protocol: 'udp'
        };
        return;
      }

      // Try TCP if UDP fails
      const tcpResult = await this.testTcpConnectivity(serverIp, serverPort);
      if (tcpResult.reachable) {
        results.sipServer = {
          reachable: true,
          latency: tcpResult.latency,
          protocol: 'tcp'
        };
        return;
      }

      // Both failed
      results.sipServer = {
        reachable: false,
        error: `Neither UDP nor TCP connection successful to ${serverIp}:${serverPort}`
      };

    } catch (error) {
      results.sipServer = {
        reachable: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async testUdpConnectivity(host: string, port: number): Promise<{ reachable: boolean; latency?: number }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const client = dgram.createSocket('udp4');
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          client.close();
          resolve({ reachable: false });
        }
      }, this.DEFAULT_TIMEOUT);

      // Send a basic SIP OPTIONS message to test connectivity
      const sipOptions = this.createSipOptionsMessage(host, port);
      
      client.send(sipOptions, port, host, (error) => {
        if (error && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.close();
          resolve({ reachable: false });
        }
      });

      // Listen for any response (even errors indicate the server is reachable)
      client.on('message', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.close();
          resolve({ 
            reachable: true, 
            latency: Date.now() - startTime 
          });
        }
      });

      client.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.close();
          resolve({ reachable: false });
        }
      });
    });
  }

  private async testTcpConnectivity(host: string, port: number): Promise<{ reachable: boolean; latency?: number }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new net.Socket();
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve({ reachable: false });
        }
      }, this.DEFAULT_TIMEOUT);

      socket.connect(port, host, () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          socket.end();
          resolve({ 
            reachable: true, 
            latency: Date.now() - startTime 
          });
        }
      });

      socket.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          socket.destroy();
          resolve({ reachable: false });
        }
      });
    });
  }

  private createSipOptionsMessage(host: string, port: number): Buffer {
    // Create a minimal SIP OPTIONS message for connectivity testing
    const message = [
      `OPTIONS sip:${host}:${port} SIP/2.0`,
      `Via: SIP/2.0/UDP 127.0.0.1:5060;branch=z9hG4bK-test`,
      `From: <sip:test@127.0.0.1>;tag=test`,
      `To: <sip:${host}:${port}>`,
      `Call-ID: test-connectivity-${Date.now()}`,
      `CSeq: 1 OPTIONS`,
      `Max-Forwards: 70`,
      `User-Agent: VoIP-Agent-Test/1.0`,
      `Content-Length: 0`,
      '',
      ''
    ].join('\r\n');

    return Buffer.from(message);
  }

  private async testStunServers(stunServers: string[], results: NetworkTestResult): Promise<void> {
    console.log(`🌐 Testing STUN servers: ${stunServers.length} servers`);

    const promises = stunServers.map(async (server) => {
      try {
        const reachable = await this.testStunServer(server);
        return {
          server,
          reachable,
          ...(reachable && { natType: 'unknown' }) // Would need actual STUN protocol implementation to detect NAT type
        };
      } catch (error) {
        return {
          server,
          reachable: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    results.stunServers = await Promise.all(promises);
  }

  private async testStunServer(stunServer: string): Promise<boolean> {
    // Parse STUN server URL (e.g., "stun:stun.l.google.com:19302")
    const match = stunServer.match(/^stun:([^:]+):(\d+)$/);
    if (!match) {
      throw new Error(`Invalid STUN server format: ${stunServer}`);
    }

    const [, host, portStr] = match;
    const port = parseInt(portStr, 10);

    // Test basic UDP connectivity to STUN server
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          client.close();
          resolve(false);
        }
      }, this.DEFAULT_TIMEOUT);

      // Send a basic STUN binding request
      const stunRequest = this.createStunBindingRequest();
      
      client.send(stunRequest, port, host, (error) => {
        if (error && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.close();
          resolve(false);
        }
      });

      client.on('message', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.close();
          resolve(true);
        }
      });

      client.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.close();
          resolve(false);
        }
      });
    });
  }

  private createStunBindingRequest(): Buffer {
    // Create a minimal STUN binding request for connectivity testing
    // This is a simplified version - a full STUN implementation would be more complex
    const buffer = Buffer.alloc(20);
    
    // STUN message type: Binding Request (0x0001)
    buffer.writeUInt16BE(0x0001, 0);
    
    // Message length: 0 (no attributes)
    buffer.writeUInt16BE(0x0000, 2);
    
    // Magic cookie
    buffer.writeUInt32BE(0x2112A442, 4);
    
    // Transaction ID (96 bits / 12 bytes)
    for (let i = 0; i < 12; i++) {
      buffer[8 + i] = Math.floor(Math.random() * 256);
    }
    
    return buffer;
  }

  private generateRecommendations(results: NetworkTestResult, config: SIPAdvancedConfig): void {
    const recommendations = results.recommendations;
    const provider = config._providerProfile?.name?.toLowerCase();

    // SIP server recommendations
    if (!results.sipServer.reachable) {
      recommendations.push('SIP server is not reachable - check firewall and network connectivity');
      recommendations.push('Verify server IP address and port configuration');
      
      if (!config.stunServers?.length) {
        recommendations.push('Consider adding STUN servers for NAT traversal');
      }
    } else {
      if (results.sipServer.protocol === 'tcp') {
        // Special handling for Fritz Box UDP testing
        if (provider === 'avm fritz!box' || config.serverIp?.startsWith('192.168.')) {
          recommendations.push('NOTE: Fritz Box detected - UDP likely works fine for actual SIP calls');
          recommendations.push('Our UDP test sends SIP OPTIONS which Fritz Box may ignore for security');
          recommendations.push('TCP connectivity confirmed, but SIP registration will likely use UDP successfully');
        } else {
          recommendations.push('SIP server only reachable via TCP - consider firewall configuration for UDP');
        }
      }
      
      if (results.sipServer.latency && results.sipServer.latency > 200) {
        recommendations.push(`High latency detected (${results.sipServer.latency}ms) - check network path to SIP server`);
      } else if (results.sipServer.latency && results.sipServer.latency < 50) {
        recommendations.push(`Excellent latency (${results.sipServer.latency}ms) - local network performance is optimal`);
      }
    }

    // STUN server recommendations
    const unreachableStun = results.stunServers.filter(s => !s.reachable);
    if (unreachableStun.length > 0) {
      recommendations.push(`${unreachableStun.length} STUN server(s) unreachable - NAT traversal may fail`);
      
      if (unreachableStun.length === results.stunServers.length) {
        recommendations.push('All STUN servers unreachable - consider using different STUN servers');
        recommendations.push('Try Google STUN servers: stun:stun.l.google.com:19302');
      }
    }

    // Provider-specific recommendations (using provider variable from above)
    if (provider === 'fritz-box' && config.stunServers?.length) {
      recommendations.push('Fritz Box typically doesn\'t need STUN servers on local network');
    } else if (provider !== 'fritz-box' && !config.stunServers?.length && !results.sipServer.reachable) {
      recommendations.push(`${config._providerProfile?.name || 'This provider'} may require STUN servers for NAT traversal`);
    }

    // Transport recommendations
    if (!results.sipServer.reachable && !config.preferredTransports?.includes('tcp')) {
      recommendations.push('Consider adding TCP transport as fallback');
    }
  }
}