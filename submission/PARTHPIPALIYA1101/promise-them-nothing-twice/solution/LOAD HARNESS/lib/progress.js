const readline = require('readline');

class ProgressDashboard {
  constructor(totalDurationSeconds, targetRpm) {
    this.totalDurationSeconds = Math.max(1, totalDurationSeconds || 10);
    this.targetRpm = targetRpm || 60;
    this.startTime = null;
    this.timer = null;
    this.lastMetrics = null;
    this.isFinished = false;
    this.resizeHandler = null;
  }

  /**
   * Format seconds to MM:SS
   * @param {number} totalSec 
   * @returns {string}
   */
  formatTime(totalSec) {
    const minutes = Math.floor(totalSec / 60);
    const seconds = Math.floor(totalSec % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Start Live Terminal Dashboard
   */
  start() {
    this.startTime = Date.now();
    this.isFinished = false;

    // Handle terminal resize gracefully
    this.resizeHandler = () => {
      if (!this.isFinished) {
        this.render();
      }
    };
    process.stdout.on('resize', this.resizeHandler);

    // Initial render
    this.render();

    // Refresh every 250ms
    this.timer = setInterval(() => {
      this.render();
    }, 250);
  }

  /**
   * Update metrics from parser
   * @param {Object} snapshot 
   */
  update(snapshot) {
    this.lastMetrics = snapshot;
  }

  /**
   * Phase 9 — Live Terminal Output Frame Renderer
   */
  render() {
    if (this.isFinished) return;

    const elapsedSeconds = Math.min(
      this.totalDurationSeconds,
      (Date.now() - (this.startTime || Date.now())) / 1000
    );
    const progressRatio = Math.min(1, elapsedSeconds / this.totalDurationSeconds);
    const percentage = Math.floor(progressRatio * 100);

    const timeFormatted = this.formatTime(elapsedSeconds);

    // Reposition cursor & clear lines cleanly
    readline.cursorTo(process.stdout, 0, 4);
    readline.clearScreenDown(process.stdout);

    const lines = [
      'Running...',
      '',
      `Elapsed   : ${timeFormatted}`,
      `Target RPM : ${this.targetRpm}`,
      `Progress  : ${percentage}%`
    ];

    process.stdout.write(lines.join('\n') + '\n');
  }

  /**
   * Stop progress dashboard cleanly
   */
  stop() {
    if (this.isFinished) return;
    this.isFinished = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.resizeHandler) {
      process.stdout.removeListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    // Newline after completion
    console.log('\n');
  }
}

module.exports = ProgressDashboard;
