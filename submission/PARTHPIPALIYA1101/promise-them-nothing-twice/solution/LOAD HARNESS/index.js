const { checkK6Installed, logError, colors } = require('./lib/utils');
const { checkEnvFileExists } = require('./lib/config');
const { promptUserConfig } = require('./lib/cli');
const { validateConfig } = require('./lib/validate');
const { runLoadTest } = require('./lib/runner');
const { printSummaryReport } = require('./lib/summary');

async function main() {
  // Phase 12 — Check missing .env configuration file (handled strictly as an error)
  if (!checkEnvFileExists()) {
    logError(
      'Missing .env file',
      'Configuration file .env was not found in the root directory.\nPlease create a .env file with BASE_URL, ENDPOINT, METHOD, and HEADER_NAME.'
    );
    process.exit(1);
  }

  // Phase 12 — Check system prerequisite (k6 binary)
  const k6Check = checkK6Installed();
  if (!k6Check.installed) {
    console.log(colors.yellow('⚠️  k6 warning: k6 binary was not detected on system PATH.'));
    console.log(colors.dim('   Please install k6 (https://k6.io/docs/get-started/installation/) to execute tests.\n'));
  }

  try {
    // Phase 3 & 14 — Interactive CLI Prompts & Test Mode Menu
    const { confirmed, config } = await promptUserConfig();

    if (!confirmed || !config) {
      console.log(colors.yellow('\nTest execution cancelled by user.\n'));
      process.exit(0);
    }

    // Phase 4 & 12 — Input Validation with friendly messages
    const validation = validateConfig(config);
    if (!validation.valid) {
      logError('Invalid configuration settings', validation.errors.join('\n   - '));
      process.exit(1);
    }

    // Phase 8, 9, 10, 13 — Execute k6, Live Dashboard, Ctrl+C Trap, Metrics Parser
    const runResult = await runLoadTest(config);

    // Phase 11 — Print Final Summary Report
    const exitCode = runResult.exitCode || (runResult.success ? 0 : 1);
    printSummaryReport(runResult.results, config, exitCode);

    process.exit(exitCode);

  } catch (error) {
    // Phase 12 — Friendly Error Handling (No stack traces unless DEBUG=true)
    if (error.isTtyError) {
      logError('Terminal error', 'Interactive CLI mode is not supported in current environment.');
    } else {
      logError('Fatal Execution Error', error);
    }
    process.exit(1);
  }
}

main();
