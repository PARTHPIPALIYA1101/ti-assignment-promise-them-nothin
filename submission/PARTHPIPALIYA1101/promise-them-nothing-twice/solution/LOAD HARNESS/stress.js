import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// Custom counters for explicit metric accounting
const successRequests = new Counter('success_requests');
const rejectedRequests = new Counter('rejected_requests');
const failedRequests = new Counter('failed_requests');

// Read runtime parameters dynamically from environment (__ENV)
const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const endpoint = (__ENV.ENDPOINT || '/api/v1/protected/ping').startsWith('/')
  ? __ENV.ENDPOINT || '/api/v1/protected/ping'
  : `/${__ENV.ENDPOINT}`;

const targetUrl = `${baseUrl}${endpoint}`;
const method = (__ENV.METHOD || 'GET').toUpperCase();
const headerName = __ENV.HEADER_NAME || 'X-Customer-ID';
const customerId = __ENV.CUSTOMER_ID || '';

const rawRps = parseFloat(__ENV.RPS || '1.0');
const rawRpm = parseFloat(__ENV.RPM || String(rawRps * 60));
const durationStr = __ENV.DURATION || '30s';
const testMode = (__ENV.MODE || 'constant').toLowerCase();

/**
 * Helper to parse duration string (e.g. "30s", "2m", "5m", "1h") to seconds integer
 */
function parseDurationSec(dur) {
  if (typeof dur === 'number') return dur;
  if (!dur || typeof dur !== 'string') return 30;
  const match = dur.trim().match(/^(\d+)\s*(s|m|h)?$/i);
  if (!match) return parseInt(dur, 10) || 30;
  const val = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  if (unit === 'm') return val * 60;
  if (unit === 'h') return val * 3600;
  return val;
}

/**
 * Generate k6 scenario options based on Test Mode.
 * CRITICAL FIX: k6 Go struct Options.scenarios.rate requires an integer (int64).
 * We use timeUnit: '1m' with integer RPM, or integer RPS with timeUnit: '1s'.
 */
function buildScenarioOptions() {
  const preAllocated = Math.max(5, Math.ceil(rawRps * 2));
  const maxVUs = Math.max(50, Math.ceil(rawRps * 10));
  const totalSec = Math.max(1, parseDurationSec(durationStr));
  
  // Integer RPM for k6 rate int64 struct compatibility
  const targetRpmInt = Math.max(1, Math.round(rawRpm));

  switch (testMode) {
    case 'ramp': {
      const stage1 = Math.max(1, Math.floor(totalSec * 0.6));
      const stage2 = Math.max(1, totalSec - stage1);
      return {
        mode_scenario: {
          executor: 'ramping-arrival-rate',
          startRate: 0,
          timeUnit: '1m',
          preAllocatedVUs: preAllocated,
          maxVUs: maxVUs,
          stages: [
            { target: Math.round(targetRpmInt * 0.5), duration: `${stage1}s` },
            { target: targetRpmInt, duration: `${stage2}s` }
          ]
        }
      };
    }

    case 'spike': {
      const s1 = Math.max(1, Math.floor(totalSec * 0.3));
      const s2 = Math.max(1, Math.floor(totalSec * 0.4));
      const s3 = Math.max(1, totalSec - s1 - s2);
      return {
        mode_scenario: {
          executor: 'ramping-arrival-rate',
          startRate: targetRpmInt,
          timeUnit: '1m',
          preAllocatedVUs: preAllocated,
          maxVUs: Math.max(100, Math.ceil(rawRps * 15)),
          stages: [
            { target: targetRpmInt, duration: `${s1}s` },
            { target: Math.round(targetRpmInt * 2.5), duration: `${s2}s` },
            { target: targetRpmInt, duration: `${s3}s` }
          ]
        }
      };
    }

    case 'stress': {
      const s1 = Math.max(1, Math.floor(totalSec * 0.25));
      const s2 = Math.max(1, Math.floor(totalSec * 0.25));
      const s3 = Math.max(1, Math.floor(totalSec * 0.25));
      const s4 = Math.max(1, totalSec - s1 - s2 - s3);
      return {
        mode_scenario: {
          executor: 'ramping-arrival-rate',
          startRate: Math.round(targetRpmInt * 0.5),
          timeUnit: '1m',
          preAllocatedVUs: preAllocated,
          maxVUs: Math.max(100, Math.ceil(rawRps * 15)),
          stages: [
            { target: Math.round(targetRpmInt * 0.5), duration: `${s1}s` },
            { target: targetRpmInt, duration: `${s2}s` },
            { target: Math.round(targetRpmInt * 1.5), duration: `${s3}s` },
            { target: Math.round(targetRpmInt * 2.0), duration: `${s4}s` }
          ]
        }
      };
    }

    case 'soak':
    case 'constant':
    default:
      return {
        mode_scenario: {
          executor: 'constant-arrival-rate',
          rate: targetRpmInt, // Integer int64 rate
          timeUnit: '1m',     // Per minute unit for exact RPM mapping
          duration: `${totalSec}s`,
          preAllocatedVUs: preAllocated,
          maxVUs: maxVUs
        }
      };
  }
}

export const options = {
  scenarios: buildScenarioOptions()
};

export default function () {
  const params = {
    headers: {
      'User-Agent': 'RateLimiter-LoadHarness/1.0',
      [headerName]: customerId,
      'Accept': 'application/json',
    },
    timeout: '10s',
  };

  const response = http.request(method, targetUrl, null, params);

  // Increment custom counters based on response.status
  if (response && response.status) {
    if (response.status >= 200 && response.status < 400) {
      successRequests.add(1);
    } else if (response.status === 429) {
      rejectedRequests.add(1);
    } else {
      failedRequests.add(1);
    }
  } else {
    failedRequests.add(1);
  }

  // Checks for response assertions
  check(response, {
    'status is 200 or 429': (r) => Boolean(r && (r.status === 200 || r.status === 429)),
  });
}
