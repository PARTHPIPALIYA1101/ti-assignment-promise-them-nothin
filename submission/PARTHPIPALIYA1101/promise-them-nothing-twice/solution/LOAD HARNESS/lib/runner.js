const { spawn } = require('child_process');
const path = require('path');
const K6Parser = require('./parser');
const ProgressDashboard = require('./progress');
const { parseDurationToSeconds, createSpinner, logError, colors } = require('./utils');

/**
 * Phase 8 — Execute k6 via child_process.spawn()
 * Prints exact k6 command before execution and routes stderr directly to terminal.
 * @param {Object} config Runtime configuration object
 * @returns {Promise<{ success: boolean, exitCode: number, results: Object, interrupted: boolean }>}
 */
function runLoadTest(config) {
  return new Promise((resolve) => {
    const scriptPath = config.scriptPath || path.resolve(process.cwd(), 'stress.js');
    const durationSec = parseDurationToSeconds(config.DURATION);

    const parser = new K6Parser();
    const dashboard = new ProgressDashboard(durationSec, config.RPM);
    const spinner = createSpinner('Launching k6 engine process...');

    // Prepare k6 CLI args and environment parameters
    const k6Args = [
      'run',
      '-e', `BASE_URL=${config.BASE_URL}`,
      '-e', `ENDPOINT=${config.ENDPOINT}`,
      '-e', `METHOD=${config.METHOD}`,
      '-e', `HEADER_NAME=${config.HEADER_NAME}`,
      '-e', `CUSTOMER_ID=${config.CUSTOMER_ID}`,
      '-e', `RPM=${config.RPM}`,
      '-e', `RPS=${config.RPS}`,
      '-e', `DURATION=${config.DURATION}`,
      '-e', `MODE=${config.MODE || 'constant'}`,
      '--out', 'json=-',
      scriptPath
    ];

    // Print exact k6 command before spawning it
    const fullCommandStr = `k6 ${k6Args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
    console.log(colors.cyan('\nExecuting Command:'));
    console.log(colors.bold(colors.yellow(`$ ${fullCommandStr}\n`)));

    spinner.start();

    let k6Process = null;
    let interrupted = false;

    // Ctrl+C SIGINT / SIGTERM graceful shutdown trap
    const cleanupSignalHandler = () => {
      interrupted = true;
      spinner.stop();
      dashboard.stop();
      if (k6Process && !k6Process.killed) {
        try {
          k6Process.kill('SIGINT');
        } catch (e) {
          // Ignore kill error
        }
      }
      console.log(colors.yellow('\n\n⚠️ Test execution interrupted by user (Ctrl+C).\n'));
      resolve({
        success: false,
        exitCode: 130,
        results: parser.getParsedResults(durationSec),
        interrupted: true
      });
    };

    process.once('SIGINT', cleanupSignalHandler);
    process.once('SIGTERM', cleanupSignalHandler);

    try {
      k6Process = spawn('k6', k6Args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });
    } catch (err) {
      spinner.stop();
      process.removeListener('SIGINT', cleanupSignalHandler);
      process.removeListener('SIGTERM', cleanupSignalHandler);
      logError('Failed to spawn k6 child process', err);
      return resolve({
        success: false,
        exitCode: 1,
        results: parser.getParsedResults(0),
        interrupted: false
      });
    }

    let spinnerStopped = false;

    // Parse stdout metrics stream
    k6Process.stdout.on('data', (data) => {
      if (!spinnerStopped) {
        spinner.stop();
        spinnerStopped = true;
        dashboard.start();
      }
      parser.parseChunk(data, (parsed) => {
        dashboard.update(parsed);
      });
    });

    // Stream stderr directly so any k6 errors are immediately visible
    k6Process.stderr.on('data', (data) => {
      if (!spinnerStopped) {
        spinner.stop();
        spinnerStopped = true;
        dashboard.start();
      }
      process.stderr.write(data);
    });

    k6Process.on('error', (err) => {
      if (!spinnerStopped) spinner.stop();
      dashboard.stop();
      process.removeListener('SIGINT', cleanupSignalHandler);
      process.removeListener('SIGTERM', cleanupSignalHandler);

      if (err.code === 'ENOENT') {
        logError('k6 executable not found on system PATH', 'Please install k6 (https://k6.io/docs/get-started/installation/) to execute tests.');
      } else {
        logError('k6 process execution failed', err);
      }

      resolve({
        success: false,
        exitCode: 1,
        results: parser.getParsedResults(durationSec),
        interrupted: false
      });
    });

    k6Process.on('close', (code) => {
      if (!spinnerStopped) spinner.stop();
      dashboard.stop();
      process.removeListener('SIGINT', cleanupSignalHandler);
      process.removeListener('SIGTERM', cleanupSignalHandler);

      if (interrupted) return;

      const parsedResults = parser.getParsedResults(durationSec);
      const success = code === 0;

      resolve({
        success,
        exitCode: code || 0,
        results: parsedResults,
        interrupted: false
      });
    });
  });
}

module.exports = {
  runLoadTest
};
