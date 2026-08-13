require('dotenv').config();

/**
 * Per-Source Rate Limiter & Delay Queue
 * Driven by environment variable defaults (never hard-coded authoritative platform claims).
 */
class SourceRateLimiter {
  constructor() {
    this.lastExecutionTimes = new Map();
  }

  /**
   * Retrieves configurable rate limit parameters per source name.
   */
  getRateLimitConfig(sourceName) {
    const sName = (sourceName || '').toLowerCase();

    if (sName.includes('adzuna')) {
      return {
        minDelayMs: parseInt(process.env.ADZUNA_MIN_DELAY_MS || '2000', 10),
        maxReqPerMin: parseInt(process.env.ADZUNA_MAX_REQUESTS_PER_MINUTE || '30', 10)
      };
    } else if (sName.includes('greenhouse')) {
      return {
        minDelayMs: parseInt(process.env.GREENHOUSE_MIN_DELAY_MS || '1000', 10),
        maxReqPerMin: parseInt(process.env.GREENHOUSE_MAX_REQUESTS_PER_MINUTE || '60', 10)
      };
    } else if (sName.includes('lever')) {
      return {
        minDelayMs: parseInt(process.env.LEVER_MIN_DELAY_MS || '1000', 10),
        maxReqPerMin: parseInt(process.env.LEVER_MAX_REQUESTS_PER_MINUTE || '60', 10)
      };
    }

    return {
      minDelayMs: 1000,
      maxReqPerMin: 60
    };
  }

  /**
   * Enforces configurable delay per source.
   */
  async throttle(sourceName) {
    const sName = (sourceName || 'default').toLowerCase();
    const config = this.getRateLimitConfig(sName);
    const lastTime = this.lastExecutionTimes.get(sName) || 0;
    const now = Date.now();
    const elapsed = now - lastTime;

    if (elapsed < config.minDelayMs) {
      const waitTime = config.minDelayMs - elapsed;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastExecutionTimes.set(sName, Date.now());
  }
}

const rateLimiterInstance = new SourceRateLimiter();

module.exports = {
  SourceRateLimiter,
  rateLimiterInstance
};
