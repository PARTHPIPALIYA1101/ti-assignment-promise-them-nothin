export interface TokenBucketData {
  tokens: number;
  burstTokens: number;
  lastRefill: number; // Timestamp in milliseconds
}

export interface ConsumeResult {
  allowed: boolean;
  source: 'BASE' | 'BURST' | 'NONE';
  tokensRemaining: number;
  burstRemaining: number;
  retryAfterMs?: number;
}
