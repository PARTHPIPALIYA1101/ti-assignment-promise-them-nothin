/**
 * Phase 14 — Test Modes Definition and Mapping
 */
const TEST_MODES = {
  constant: {
    id: 'constant',
    number: 1,
    name: 'Constant RPM',
    description: 'Steady sustained request rate'
  },
  ramp: {
    id: 'ramp',
    number: 2,
    name: 'Ramp RPM',
    description: 'Ramps up from 0 to target RPM smoothly'
  },
  spike: {
    id: 'spike',
    number: 3,
    name: 'Spike RPM',
    description: 'Sudden burst to 2x target RPM'
  },
  stress: {
    id: 'stress',
    number: 4,
    name: 'Stress RPM',
    description: 'Stepped load increases to find breaking point'
  },
  soak: {
    id: 'soak',
    number: 5,
    name: 'Soak RPM',
    description: 'Sustained endurance test over extended duration'
  }
};

/**
 * Get mode by ID or selection number
 * @param {string|number} key 
 * @returns {Object}
 */
function getMode(key) {
  if (TEST_MODES[key]) return TEST_MODES[key];
  const numKey = parseInt(key, 10);
  const found = Object.values(TEST_MODES).find((m) => m.number === numKey);
  return found || TEST_MODES.constant;
}

module.exports = {
  TEST_MODES,
  getMode
};
