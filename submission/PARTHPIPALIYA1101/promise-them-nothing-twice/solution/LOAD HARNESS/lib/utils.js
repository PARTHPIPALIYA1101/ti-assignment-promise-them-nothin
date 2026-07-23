const { execSync } = require('child_process');

/**
 * ANSI Color Escape Codes
 */
const colors = {
  reset: '\x1b[0m',
  bold: (str) => `\x1b[1m${str}\x1b[22m`,
  dim: (str) => `\x1b[2m${str}\x1b[22m`,
  italic: (str) => `\x1b[3m${str}\x1b[23m`,
  underline: (str) => `\x1b[4m${str}\x1b[24m`,
  
  red: (str) => `\x1b[31m${str}\x1b[39m`,
  green: (str) => `\x1b[32m${str}\x1b[39m`,
  yellow: (str) => `\x1b[33m${str}\x1b[39m`,
  blue: (str) => `\x1b[34m${str}\x1b[39m`,
  magenta: (str) => `\x1b[35m${str}\x1b[39m`,
  cyan: (str) => `\x1b[36m${str}\x1b[39m`,
  white: (str) => `\x1b[37m${str}\x1b[39m`,
  gray: (str) => `\x1b[90m${str}\x1b[39m`,

  bgBlue: (str) => `\x1b[44m${str}\x1b[49m`,
  bgCyan: (str) => `\x1b[46m${str}\x1b[49m`,
  bgGreen: (str) => `\x1b[42m\x1b[30m${str}\x1b[39m\x1b[49m`,
  bgRed: (str) => `\x1b[41m\x1b[37m${str}\x1b[39m\x1b[49m`
};

/**
 * Format milliseconds into human-readable latency string
 * @param {number} ms 
 * @returns {string}
 */
function formatMs(ms) {
  if (ms === undefined || ms === null || isNaN(ms)) return '0ms';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format numbers with comma separation
 * @param {number} num 
 * @returns {string}
 */
function formatNumber(num) {
  const n = Number(num) || 0;
  return n.toLocaleString();
}

/**
 * Parse human duration string (e.g. "30s", "2m", "5m", "1h") to seconds
 * @param {string|number} duration 
 * @returns {number} duration in seconds
 */
function parseDurationToSeconds(duration) {
  if (typeof duration === 'number') return duration;
  if (!duration || typeof duration !== 'string') return 0;
  
  const match = duration.trim().match(/^(\d+)\s*(s|m|h)?$/i);
  if (!match) return parseInt(duration, 10) || 0;
  
  const value = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  
  switch (unit) {
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 's':
    default:
      return value;
  }
}

/**
 * Check if k6 executable is available on PATH
 * @returns {{ installed: boolean, version: string }}
 */
function checkK6Installed() {
  try {
    const stdout = execSync('k6 version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const versionMatch = stdout.match(/k6 v?([^\s]+)/i);
    const version = versionMatch ? versionMatch[1] : stdout.trim();
    return { installed: true, version };
  } catch (error) {
    return { installed: false, version: null };
  }
}

/**
 * Phase 13 — Terminal Spinner for loading animations
 */
function createSpinner(text = 'Launching k6 load engine...') {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let index = 0;
  let timer = null;

  return {
    start() {
      process.stdout.write('\x1b[?25l'); // Hide cursor
      timer = setInterval(() => {
        const frame = colors.cyan(frames[index]);
        process.stdout.write(`\r${frame} ${text}`);
        index = (index + 1) % frames.length;
      }, 80);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      process.stdout.write('\r\x1b[K'); // Clear line
      process.stdout.write('\x1b[?25h'); // Show cursor
    }
  };
}

/**
 * Phase 12 — Human-friendly Error Logger
 * Suppresses stack traces unless DEBUG=true or --debug flag is set.
 * @param {string} title 
 * @param {Error|string} error 
 */
function logError(title, error) {
  const isDebug = process.env.DEBUG === 'true' || process.argv.includes('--debug');
  console.error(colors.red(`\n❌ Error: ${title}`));
  if (error) {
    const msg = typeof error === 'string' ? error : error.message;
    console.error(colors.yellow(`   ${msg}`));
    if (isDebug && error.stack) {
      console.error(colors.dim(`\n--- Stack Trace (Debug Mode) ---\n${error.stack}\n`));
    }
  }
  console.error('');
}

/**
 * Draw title banner
 */
function printBanner() {
  console.log(colors.cyan('============================='));
  console.log(colors.bold(colors.cyan('Rate Limiter Load Harness')));
  console.log(colors.cyan('=============================\n'));
}

module.exports = {
  colors,
  formatMs,
  formatNumber,
  parseDurationToSeconds,
  checkK6Installed,
  createSpinner,
  logError,
  printBanner
};
