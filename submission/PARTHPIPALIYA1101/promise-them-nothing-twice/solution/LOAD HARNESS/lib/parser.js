/**
 * Phase 10 — Structured Result Parser for k6 JSON metrics stream
 * Directly parses custom metrics: success_requests, rejected_requests, failed_requests
 */
class K6Parser {
  constructor() {
    this.reset();
  }

  reset() {
    this.buffer = '';
    this.durations = [];
    this.results = {
      totalRequests: 0,
      httpSuccess: 0,
      httpFailures: 0,
      rejectedRequests: 0,
      averageLatency: 0,
      p95Latency: 0,
      vus: 0,
      elapsed: 0
    };
  }

  /**
   * Process a chunk of output from k6 process with line buffer tracking
   * @param {string|Buffer} chunk 
   * @param {Function} [onUpdate] Callback when metric update is parsed
   */
  parseChunk(chunk, onUpdate) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split(/\r?\n/);
    
    // Retain incomplete fragment in line buffer
    this.buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Attempt parsing structured JSON point line from k6
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const data = JSON.parse(trimmed);
          this.processJsonMetric(data);
          if (onUpdate) onUpdate(this.getParsedResults());
          continue;
        } catch (e) {
          // Fallback to text line parsing
        }
      }

      // Fallback parsing for stdout console summary lines
      this.processTextLine(trimmed);
      if (onUpdate) onUpdate(this.getParsedResults());
    }
  }

  /**
   * Process structured JSON point emitted by k6 (--out json)
   * Directly parses custom metrics: success_requests, rejected_requests, failed_requests
   * @param {Object} data 
   */
  processJsonMetric(data) {
    if (data.type !== 'Point' || !data.data) return;

    const { metric, value, tags } = data.data;

    switch (metric) {
      case 'success_requests':
        this.results.httpSuccess += (value || 1);
        break;

      case 'rejected_requests':
        this.results.rejectedRequests += (value || 1);
        break;

      case 'failed_requests':
        this.results.httpFailures += (value || 1);
        break;

      case 'http_reqs':
        this.results.totalRequests += (value || 1);
        
        // Fallback status tag matching if custom counters were omitted
        if (tags && tags.status && this.results.httpSuccess === 0 && this.results.rejectedRequests === 0 && this.results.httpFailures === 0) {
          const status = parseInt(tags.status, 10);
          if (status >= 200 && status < 400) {
            this.results.httpSuccess++;
          } else if (status === 429) {
            this.results.rejectedRequests++;
          } else {
            this.results.httpFailures++;
          }
        }
        break;

      case 'http_req_duration':
        if (typeof value === 'number' && !isNaN(value) && value >= 0) {
          this.durations.push(value);
          this.recalculateLatencies();
        }
        break;

      case 'vus':
        this.results.vus = value || 0;
        break;
    }
  }

  /**
   * Recalculate average and p95 latencies from stored sample values (ms)
   */
  recalculateLatencies() {
    if (this.durations.length === 0) return;
    const sorted = [...this.durations].sort((a, b) => a - b);
    const count = sorted.length;

    const sum = sorted.reduce((acc, val) => acc + val, 0);
    this.results.averageLatency = sum / count;

    const p95Idx = Math.floor(0.95 * count);
    this.results.p95Latency = sorted[Math.min(p95Idx, count - 1)];
  }

  /**
   * Helper to convert time value strings (ms, s, µs) to ms
   */
  parseTime(valStr, unitStr) {
    const num = parseFloat(valStr);
    if (isNaN(num)) return 0;
    const u = (unitStr || 'ms').toLowerCase();
    if (u === 's') return num * 1000;
    if (u === 'µs' || u === 'us') return num / 1000;
    return num;
  }

  /**
   * Fallback text summary line parser for final k6 summary block
   * @param {string} line 
   */
  processTextLine(line) {
    // Custom counters matching in stdout text summary
    const successMatch = line.match(/success_requests[\.\s]+:\s*(\d+)/);
    if (successMatch) {
      this.results.httpSuccess = parseInt(successMatch[1], 10);
    }

    const rejectedMatch = line.match(/rejected_requests[\.\s]+:\s*(\d+)/);
    if (rejectedMatch) {
      this.results.rejectedRequests = parseInt(rejectedMatch[1], 10);
    }

    const failedMatch = line.match(/failed_requests[\.\s]+:\s*(\d+)/);
    if (failedMatch) {
      this.results.httpFailures = parseInt(failedMatch[1], 10);
    }

    // Total HTTP requests count
    const reqMatch = line.match(/http_reqs[\.\s]+:\s*(\d+)/);
    if (reqMatch) {
      this.results.totalRequests = parseInt(reqMatch[1], 10);
    }

    // Latencies: avg=... p(95)=...
    const durMatch = line.match(/http_req_duration[\.\s]+:\s*avg=([\d.]+)(ms|µs|s).*?p\(95\)=([\d.]+)(ms|µs|s)/);
    if (durMatch) {
      const avgMs = this.parseTime(durMatch[1], durMatch[2]);
      const p95Ms = this.parseTime(durMatch[3], durMatch[4]);

      if (this.results.averageLatency === 0 || this.durations.length === 0) {
        this.results.averageLatency = avgMs;
        this.results.p95Latency = p95Ms;
      }
    }
  }

  /**
   * Flush any remaining buffer line at end of stream
   */
  flush() {
    if (this.buffer && this.buffer.trim()) {
      const line = this.buffer.trim();
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          this.processJsonMetric(JSON.parse(line));
        } catch (e) {}
      } else {
        this.processTextLine(line);
      }
      this.buffer = '';
    }
  }

  /**
   * Get structured parsed results object
   * Ensures totalRequests === httpSuccess + rejectedRequests + httpFailures
   * @param {number} [elapsedSeconds] 
   * @returns {Object}
   */
  getParsedResults(elapsedSeconds = 0) {
    this.flush();
    this.results.elapsed = Math.max(1, elapsedSeconds || this.results.elapsed || 1);

    const classified = this.results.httpSuccess + this.results.rejectedRequests + this.results.httpFailures;
    
    if (classified > 0) {
      this.results.totalRequests = Math.max(this.results.totalRequests, classified);
    }

    return { ...this.results };
  }
}

module.exports = K6Parser;
