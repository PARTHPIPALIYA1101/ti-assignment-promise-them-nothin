const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(process.cwd(), '.env');

/**
 * Check if .env file exists. Missing .env is handled strictly as an error.
 */
function checkEnvFileExists() {
  return fs.existsSync(envPath);
}

// Load environment variables if file exists
if (checkEnvFileExists()) {
  dotenv.config({ path: envPath });
}

const envDefaults = {
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  ENDPOINT: process.env.ENDPOINT || '/api/v1/protected/ping',
  METHOD: process.env.METHOD || 'GET',
  HEADER_NAME: process.env.HEADER_NAME || 'X-Customer-ID'
};

const userDefaults = {
  CUSTOMER_ID: 'cust_12345',
  RPM: 60,
  DURATION: '30s',
  MODE: 'constant'
};

let currentConfig = {
  ...envDefaults,
  ...userDefaults
};

/**
 * Convert RPM to RPS (RPS = RPM / 60)
 * @param {number} rpm 
 * @returns {number}
 */
function convertRpmToRps(rpm) {
  const numericRpm = Number(rpm);
  if (isNaN(numericRpm)) return 0;
  const rawRps = numericRpm / 60;
  return Math.round(rawRps * 10000) / 10000;
}

/**
 * Generate Runtime Configuration Object
 * @returns {Object}
 */
function getConfig() {
  const baseUrl = (currentConfig.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const endpoint = (currentConfig.ENDPOINT || '/api/v1/protected/ping').startsWith('/')
    ? currentConfig.ENDPOINT
    : `/${currentConfig.ENDPOINT}`;

  const rawRpm = parseInt(currentConfig.RPM, 10);
  const rpm = isNaN(rawRpm) ? 60 : rawRpm;
  const rps = convertRpmToRps(rpm);

  return {
    BASE_URL: baseUrl,
    ENDPOINT: endpoint,
    METHOD: (currentConfig.METHOD || 'GET').toUpperCase(),
    HEADER_NAME: currentConfig.HEADER_NAME || 'X-Customer-ID',
    CUSTOMER_ID: currentConfig.CUSTOMER_ID !== undefined ? currentConfig.CUSTOMER_ID : '',
    RPM: rpm,
    RPS: rps,
    DURATION: currentConfig.DURATION || '30s',
    MODE: (currentConfig.MODE || 'constant').toLowerCase(),
    targetUrl: `${baseUrl}${endpoint}`,
    scriptPath: path.resolve(process.cwd(), 'stress.js')
  };
}

/**
 * Merge user inputs into configuration
 * @param {Object} overrides 
 * @returns {Object}
 */
function mergeConfig(overrides = {}) {
  currentConfig = {
    ...currentConfig,
    ...overrides
  };
  return getConfig();
}

/**
 * Reset configuration
 */
function resetConfig() {
  currentConfig = {
    ...envDefaults,
    ...userDefaults
  };
  return getConfig();
}

module.exports = {
  checkEnvFileExists,
  getConfig,
  mergeConfig,
  resetConfig,
  convertRpmToRps
};
