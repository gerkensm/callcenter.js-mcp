import { EventEmitter } from 'events';
export declare class PerformanceMonitor extends EventEmitter {
    private eventLoopTimes;
    private lastEventLoopCheck;
    private monitorInterval;
    private isMonitoring;
    private gcObserver;
    private gcEvents;
    constructor();
    startMonitoring(): void;
    stopMonitoring(): void;
    private checkEventLoopLag;
    getEventLoopStats(): {
        avg: number;
        max: number;
        recent: number;
    };
    logStats(): void;
}
//# sourceMappingURL=performance-monitor.d.ts.map