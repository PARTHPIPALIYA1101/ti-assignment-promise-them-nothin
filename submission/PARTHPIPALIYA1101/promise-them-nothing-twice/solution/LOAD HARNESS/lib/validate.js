const { parseDurationToSeconds } = require('./utils');

const DURATION_REGEX = /^(\d+)\s*(s|m|h)$/i;

/**
 * Validate HTTP/HTTPS Base URL
 * @param {string} input 
 * @returns {boolean|string} true if valid, error message string if invalid
 */
function validateBaseUrl(input) {
  if (!input || typeof input !== 'string') {
    return 'BASE_URL is required.';
  }
  const trimmed = input.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'BASE_URL must start with http:// or https://';
    }
    return true;
  } catch (err) {
    return 'Invalid BASE_URL format. Please provide a valid URL (e.g. http://localhost:3000)';
  }
}

/**
 * Validate API Endpoint path
 * @param {string} input 
 * @returns {boolean|string}
 */
function validateEndpoint(input) {
  if (input === undefined || input === null || typeof input !== 'string') {
    return 'ENDPOINT path is required.';
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return 'ENDPOINT path cannot be empty.';
  }
  if (!trimmed.startsWith('/')) {
    return 'ENDPOINT path must start with a slash / (e.g. /api/v1/protected/ping)';
  }
  return true;
}

/**
 * Validate Customer ID (Phase 4 requirement: non-empty string)
 * @param {string} input 
 * @returns {boolean|string}
 */
function validateCustomerId(input) {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return 'Customer ID is required and cannot be empty.';
  }
  return true;
}

/**
 * Validate Target RPM (Phase 4 requirement: positive integer)
 * @param {string|number} input 
 * @returns {boolean|string}
 */
function validateRpm(input) {
  const num = Number(input);
  if (isNaN(num) || !Number.isInteger(num) || num <= 0) {
    return 'Target RPM must be a positive integer greater than 0.';
  }
  return true;
}

/**
 * Validate Test Duration (Phase 4 requirement: format 30s, 2m, 5m, 1h)
 * @param {string} input 
 * @returns {boolean|string}
 */
function validateDuration(input) {
  if (input === undefined || input === null || typeof input !== 'string' || input.trim() === '') {
    return 'Duration is required.';
  }
  const trimmed = input.trim();
  if (!DURATION_REGEX.test(trimmed)) {
    return 'Duration format must be a number followed by s, m, or h (e.g., 30s, 2m, 5m, 1h).';
  }
  const seconds = parseDurationToSeconds(trimmed);
  if (isNaN(seconds) || seconds <= 0) {
    return 'Duration must be greater than 0 seconds.';
  }
  return true;
}

/**
 * Validate entire configuration object
 * @param {Object} config 
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfig(config) {
  const errors = [];

  const baseRes = validateBaseUrl(config.BASE_URL);
  if (baseRes !== true) errors.push(`BASE_URL: ${baseRes}`);

  const epRes = validateEndpoint(config.ENDPOINT);
  if (epRes !== true) errors.push(`ENDPOINT: ${epRes}`);

  const cidRes = validateCustomerId(config.CUSTOMER_ID);
  if (cidRes !== true) errors.push(`Customer ID: ${cidRes}`);

  const rpmRes = validateRpm(config.RPM);
  if (rpmRes !== true) errors.push(`Target RPM: ${rpmRes}`);

  const durRes = validateDuration(config.DURATION);
  if (durRes !== true) errors.push(`Duration: ${durRes}`);

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateBaseUrl,
  validateEndpoint,
  validateCustomerId,
  validateRpm,
  validateDuration,
  validateConfig
};
