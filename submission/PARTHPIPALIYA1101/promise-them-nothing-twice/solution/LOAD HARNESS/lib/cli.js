const inquirer = require('inquirer');
const { getConfig, mergeConfig } = require('./config');
const {
  validateCustomerId,
  validateRpm,
  validateDuration
} = require('./validate');
const { TEST_MODES } = require('./modes');
const { colors, printBanner } = require('./utils');

/**
 * Parse CLI flags for non-interactive execution
 */
function parseCliArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--yes' || arg === '-y') {
      parsed.nonInteractive = true;
    } else if (arg.startsWith('--customer-id=')) {
      parsed.CUSTOMER_ID = arg.split('=')[1];
    } else if ((arg === '--customer-id' || arg === '-c') && args[i + 1]) {
      parsed.CUSTOMER_ID = args[++i];
    } else if (arg.startsWith('--rpm=')) {
      parsed.RPM = parseInt(arg.split('=')[1], 10);
    } else if ((arg === '--rpm' || arg === '-r') && args[i + 1]) {
      parsed.RPM = parseInt(args[++i], 10);
    } else if (arg.startsWith('--duration=')) {
      parsed.DURATION = arg.split('=')[1];
    } else if ((arg === '--duration' || arg === '-d') && args[i + 1]) {
      parsed.DURATION = args[++i];
    } else if (arg.startsWith('--mode=')) {
      parsed.MODE = arg.split('=')[1];
    } else if ((arg === '--mode' || arg === '-m') && args[i + 1]) {
      parsed.MODE = args[++i];
    }
  }

  return parsed;
}

/**
 * Phase 3 & 14 — Interactive CLI with combined Inquirer prompts
 * @returns {Promise<{ confirmed: boolean, config: Object }>}
 */
async function promptUserConfig() {
  const current = getConfig();
  const cliArgs = parseCliArgs();

  // Print Rate Limiter Load Harness banner
  printBanner();

  // Non-interactive execution if --yes flag is supplied
  if (cliArgs.nonInteractive) {
    console.log(colors.cyan('⚡ Running in Non-Interactive Mode...\n'));
    const merged = mergeConfig(cliArgs);
    return { confirmed: true, config: merged };
  }

  // Build mode choices for inquirer list prompt
  const modeChoices = Object.values(TEST_MODES).map((m) => ({
    name: `${m.number} ${m.name} (${m.description})`,
    value: m.id
  }));

  // Combined single prompt array for maximum TTY/stdin compatibility
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'MODE',
      message: 'Select Test Mode:',
      choices: modeChoices,
      default: cliArgs.MODE || current.MODE || 'constant'
    },
    {
      type: 'input',
      name: 'CUSTOMER_ID',
      message: 'Customer ID:',
      default: cliArgs.CUSTOMER_ID !== undefined ? cliArgs.CUSTOMER_ID : current.CUSTOMER_ID,
      validate: (input) => validateCustomerId(input)
    },
    {
      type: 'input',
      name: 'RPM',
      message: 'Target RPM:',
      default: cliArgs.RPM !== undefined ? cliArgs.RPM : current.RPM,
      filter: (val) => parseInt(val, 10),
      validate: (input) => validateRpm(input)
    },
    {
      type: 'input',
      name: 'DURATION',
      message: 'Duration:',
      default: cliArgs.DURATION !== undefined ? cliArgs.DURATION : current.DURATION,
      validate: (input) => validateDuration(input)
    },
    {
      type: 'confirm',
      name: 'confirmTest',
      message: 'Start Test?',
      default: true
    }
  ]);

  if (!answers.confirmTest) {
    return { confirmed: false, config: null };
  }

  const merged = mergeConfig({
    CUSTOMER_ID: answers.CUSTOMER_ID,
    RPM: answers.RPM,
    DURATION: answers.DURATION,
    MODE: answers.MODE
  });

  return { confirmed: true, config: merged };
}

module.exports = {
  promptUserConfig,
  parseCliArgs
};
