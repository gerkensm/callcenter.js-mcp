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
export declare class NetworkTester {
    private readonly DEFAULT_TIMEOUT;
    testNetworkConnectivity(config: SIPAdvancedConfig): Promise<NetworkTestResult>;
    private testSipServer;
    private testUdpConnectivity;
    private testTcpConnectivity;
    private createSipOptionsMessage;
    private testStunServers;
    private testStunServer;
    private createStunBindingRequest;
    private generateRecommendations;
}
//# sourceMappingURL=network-tester.d.ts.map