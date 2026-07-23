const { colors, formatMs, formatNumber } = require('./utils');

/**
 * Phase 11 — Final Summary Report
 * Format numbers cleanly and align columns matching exact specification.
 * @param {Object} results Phase 10 parsed results object
 * @param {Object} config Runtime configuration object
 * @param {number} exitCode Exit status code
 */
function printSummaryReport(results = {}, config = {}, exitCode = 0) {
  console.log(colors.cyan('\n==================================\n'));
  console.log(colors.bold(colors.cyan('TEST COMPLETE')));
  console.log(colors.cyan('\n==================================\n'));

  const customerId = config.CUSTOMER_ID || 'N/A';
  const targetRpm = `${formatNumber(config.RPM)} RPM (${config.RPS} RPS)`;
  const duration = config.DURATION || 'N/A';

  const totalRequests = formatNumber(results.totalRequests || 0);
  const successCount = formatNumber(results.httpSuccess || 0);
  const rejectedCount = formatNumber(results.rejectedRequests || 0);
  const failedCount = formatNumber(results.httpFailures || 0);

  const avgLatency = formatMs(results.averageLatency || 0);
  const p95Latency = formatMs(results.p95Latency || 0);
  const codeStr = String(exitCode);

  const colWidth = 16;
  const printRow = (label, value) => {
    const paddedLabel = label.padEnd(colWidth);
    console.log(`${colors.dim(paddedLabel)} : ${value}`);
  };

  printRow('Customer ID', colors.magenta(customerId));
  printRow('Target RPM', colors.yellow(targetRpm));
  printRow('Duration', colors.cyan(duration));
  printRow('Requests', colors.bold(totalRequests));
  printRow('Success', colors.green(successCount));
  printRow('Rejected', rejectedCount !== '0' ? colors.yellow(rejectedCount) : colors.green(rejectedCount));
  printRow('Failed', failedCount !== '0' ? colors.red(failedCount) : colors.green(failedCount));
  printRow('Average Latency', avgLatency);
  printRow('P95', colors.bold(p95Latency));
  printRow('Exit Code', exitCode === 0 ? colors.green(codeStr) : colors.red(codeStr));

  console.log('');
  return exitCode === 0;
}

module.exports = {
  printSummaryReport
};
