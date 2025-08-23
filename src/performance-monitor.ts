import { EventEmitter } from 'events';
import { getLogger } from './logger.js';

export class PerformanceMonitor extends EventEmitter {
  private eventLoopTimes: number[] = [];
  private lastEventLoopCheck = 0;
  private monitorInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;
  private gcObserver: any = null;
  private gcEvents: Array<{type: string, duration: number, timestamp: number}> = [];

  constructor() {
    super();
  }

  startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.lastEventLoopCheck = performance.now();
    
    // Monitor GC events
    try {
      const { PerformanceObserver } = require('perf_hooks');
      this.gcObserver = new PerformanceObserver((list: any) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'gc') {
            this.gcEvents.push({
              type: entry.detail?.kind || 'unknown',
              duration: entry.duration,
              timestamp: performance.now()
            });
            if (this.gcEvents.length > 50) {
              this.gcEvents.shift();
            }
            
            // Warn on long GC pauses
            if (entry.duration > 50) {
              getLogger().perf.warn(`Long GC pause: ${entry.duration.toFixed(2)}ms (${entry.detail?.kind || 'unknown'})`);
              this.emit('longGC', entry.duration);
            }
          }
        }
      });
      this.gcObserver.observe({ entryTypes: ['gc'] });
    } catch (e) {
      getLogger().perf.debug('GC monitoring not available:', e instanceof Error ? e.message : String(e));
    }
    
    // Monitor event loop lag every 100ms
    this.monitorInterval = setInterval(() => {
      this.checkEventLoopLag();
    }, 100);
    
    getLogger().perf.debug('Performance monitoring started');
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    if (this.gcObserver) {
      this.gcObserver.disconnect();
      this.gcObserver = null;
    }
    
    getLogger().perf.debug('Performance monitoring stopped');
  }

  private checkEventLoopLag(): void {
    const now = performance.now();
    const expectedTime = this.lastEventLoopCheck + 100; // Should be ~100ms
    const actualLag = now - expectedTime;
    
    this.eventLoopTimes.push(actualLag);
    if (this.eventLoopTimes.length > 100) {
      this.eventLoopTimes.shift(); // Keep only last 100 measurements
    }
    
    this.lastEventLoopCheck = now;
    
    // Emit warning if significant lag detected
    if (actualLag > 50) {
      this.emit('eventLoopLag', actualLag);
    }
  }

  getEventLoopStats(): { avg: number; max: number; recent: number } {
    if (this.eventLoopTimes.length === 0) {
      return { avg: 0, max: 0, recent: 0 };
    }
    
    const avg = this.eventLoopTimes.reduce((a, b) => a + b) / this.eventLoopTimes.length;
    const max = Math.max(...this.eventLoopTimes);
    const recent = this.eventLoopTimes[this.eventLoopTimes.length - 1] || 0;
    
    return { avg, max, recent };
  }

  logStats(): void {
    const stats = this.getEventLoopStats();
    const memory = process.memoryUsage();
    
    // Calculate GC stats from recent events
    const recentGC = this.gcEvents.filter(gc => performance.now() - gc.timestamp < 30000);
    const gcCount = recentGC.length;
    const gcTime = recentGC.reduce((sum, gc) => sum + gc.duration, 0);
    const avgGC = gcCount > 0 ? gcTime / gcCount : 0;
    const maxGC = gcCount > 0 ? Math.max(...recentGC.map(gc => gc.duration)) : 0;
    
    getLogger().perf.verbose('System Performance:');
    getLogger().perf.verbose(`   Event Loop Lag - Avg: ${stats.avg.toFixed(2)}ms | Max: ${stats.max.toFixed(2)}ms | Recent: ${stats.recent.toFixed(2)}ms`);
    getLogger().perf.verbose(`   Memory - Heap: ${Math.round(memory.heapUsed / 1024 / 1024)}MB | RSS: ${Math.round(memory.rss / 1024 / 1024)}MB`);
    getLogger().perf.verbose(`   GC (last 30s) - Count: ${gcCount} | Avg: ${avgGC.toFixed(2)}ms | Max: ${maxGC.toFixed(2)}ms | Total: ${gcTime.toFixed(2)}ms`);
    
    // Detect if we're in degraded state
    if (stats.avg > 20 || stats.recent > 50 || maxGC > 100) {
      getLogger().perf.warn('Performance degradation detected!');
    }
  }
}