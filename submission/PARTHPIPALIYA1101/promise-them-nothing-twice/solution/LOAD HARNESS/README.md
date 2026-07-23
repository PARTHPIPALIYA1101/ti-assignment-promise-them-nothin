# Rate Limiter Load Harness ⚡

A modular, production-ready **Node.js + k6** load testing harness for validating API rate limiters.

The harness provides an interactive terminal interface, multiple load generation modes, live progress updates, structured k6 metric parsing, and a concise summary report. It is designed to test APIs protected by algorithms such as **Token Bucket**, **Sliding Window**, **Leaky Bucket**, and similar rate-limiting strategies.

---

# Features

* Interactive terminal-based CLI
* Non-interactive CLI mode for automation
* Multiple load testing modes:
  * Constant
  * Ramp
  * Spike
  * Stress
  * Soak
* Real-time progress dashboard
* Structured k6 JSON metrics parsing
* Graceful Ctrl+C handling
* Friendly error messages
* Configurable using a simple `.env` file
* Production-quality modular architecture

---

# Project Architecture

```text
load-harness/
│
├── .env                  # Required environment configuration (BASE_URL, ENDPOINT, METHOD, HEADER_NAME)
├── package.json          # Node.js manifest & dependencies (dotenv, inquirer)
├── index.js              # Entry point & workflow orchestrator
├── stress.js             # Reusable k6 test script (multi-mode scenario executor)
│
├── lib/
│   ├── cli.js            # Interactive CLI & Test Mode menu prompt
│   ├── validate.js       # Customer ID, RPM, and Duration format validator
│   ├── config.js         # Config loader & RPM-to-RPS converter (RPS = RPM / 60)
│   ├── modes.js           # Test modes definition & k6 scenario mapper
│   ├── runner.js         # child_process.spawn wrapper with Ctrl+C trap & spinner
│   ├── parser.js         # Structured k6 JSON metrics stream parser
│   ├── summary.js        # Post-test final summary reporter
│   ├── progress.js       # Live in-place terminal progress dashboard
│   └── utils.js          # Terminal title banner, spinner, & error handler
│
└── README.md             # Documentation
```

---

# Module Overview

| File        | Responsibility                                           |
| ----------- | -------------------------------------------------------- |
| `index.js`   | Application entry point and workflow orchestration       |
| `stress.js`  | k6 load generation script                                |
| `cli.js`     | Interactive CLI prompts                                  |
| `validate.js`| Customer ID, RPM and duration validation                 |
| `config.js`  | Loads `.env` configuration and converts RPM → RPS        |
| `modes.js`   | Defines Constant, Ramp, Spike, Stress and Soak scenarios |
| `runner.js`  | Executes k6 using `child_process`                        |
| `parser.js`  | Parses k6 JSON metrics                                   |
| `progress.js`| Live terminal progress display                           |
| `summary.js` | Final statistics report                                  |
| `utils.js`   | Banner, spinner and utility helpers                      |

---

# Requirements

* **Node.js** (Latest LTS)
* **k6** (installed on system PATH)

## Install k6

### Windows
```bash
winget install k6
# or
choco install k6
```

### macOS
```bash
brew install k6
```

### Linux (Debian/Ubuntu)
```bash
sudo apt install k6
```

---

# Installation

```bash
npm install
```

---

# Configuration

Create a `.env` file in the root directory:

```env
BASE_URL=http://localhost:3000
ENDPOINT=/api/v1/protected/ping
METHOD=GET
HEADER_NAME=X-Customer-ID
```

> [!IMPORTANT]
> If the `.env` file is missing, the application exits immediately with a helpful error message.

---

# Running

## Interactive Mode

```bash
npm start
# or
node index.js
```

Displays header banner and prompts:

```text
=============================
Rate Limiter Load Harness
=============================

Select Test Mode:
  1 Constant RPM
  2 Ramp RPM
  3 Spike RPM
  4 Stress RPM
  5 Soak RPM
```

Interactive prompts:
* Customer ID
* Target RPM
* Duration
* Confirmation (Y/N)

---

## Non-Interactive Mode

```bash
node index.js \
  --customer-id=bd116379-909c-4caf-85dd-a7a83f1f72dd \
  --rpm=600 \
  --duration=1m \
  --mode=constant \
  --yes
```

### Available CLI Flags

| Flag | Shortcut | Description |
| ---- | -------- | ----------- |
| `--customer-id` | `-c` | Customer ID (required, non-empty) |
| `--rpm` | `-r` | Target Requests Per Minute (positive integer) |
| `--duration` | `-d` | Test duration (`30s`, `1m`, `5m`, `1h`) |
| `--mode` | `-m` | `constant`, `ramp`, `spike`, `stress`, `soak` |
| `--yes` | `-y` | Non-interactive auto-run mode |

---

# Live Progress Dashboard

```text
Running...

Elapsed     : 00:15
Target RPM  : 600
Progress    : 50%
```

---

# Final Summary Report

```text
==================================

TEST COMPLETE

==================================

Customer ID      : bd116379-909c-4caf-85dd-a7a83f1f72dd
Target RPM       : 600 RPM (10 RPS)
Duration         : 1m
Requests         : 601
Success          : 599
Rejected         : 2
Failed           : 0
Average Latency  : 4.7ms
P95              : 4.5ms
Exit Code        : 0
```

---

# Token Bucket Verification Example

The load harness was used to validate a **Token Bucket** rate limiter configured with a **300 RPM** plan.

### Customer ID
```text
bd116379-909c-4caf-85dd-a7a83f1f72dd
```

### Test Configuration

| Parameter   | Value            |
| ----------- | ---------------- |
| Mode        | Constant         |
| Target Rate | 600 RPM (10 RPS) |
| Duration    | 1 minute (`1m`)  |

### Summary Result

```text
==================================

TEST COMPLETE

==================================

Customer ID      : bd116379-909c-4caf-85dd-a7a83f1f72dd
Target RPM       : 600 RPM (10 RPS)
Duration         : 1m
Requests         : 601
Success          : 599
Rejected         : 2
Failed           : 0
Average Latency  : 4.7ms
P95              : 4.5ms
Exit Code        : 0
```

### Why weren't all requests rejected?

The tested rate limiter uses a **Token Bucket** algorithm.

Unlike a fixed-window limiter, a Token Bucket accumulates tokens while the client is idle. These stored tokens allow an initial burst of requests to be processed successfully before rate limiting begins.

During this test:
* Customer plan: **300 RPM**
* Test rate: **600 RPM**

Initial requests were accepted because burst tokens were available. Once the bucket was exhausted, additional requests were rejected with **HTTP 429 Too Many Requests**.

This demonstrates that burst handling and rate-limit enforcement are functioning correctly.

---

# Error Handling

The harness handles common failure scenarios gracefully without stack traces (unless running in debug mode):
* Missing `.env`
* Invalid Customer ID
* Invalid RPM
* Invalid duration
* Missing k6 installation
* Interrupted execution (Ctrl+C)
* Invalid command-line arguments

---

# Debug Mode

Enable detailed stack traces and logging:

```bash
DEBUG=true node index.js
# or
node index.js --debug
```

---

# Exit Codes

| Exit Code | Meaning |
| --------- | ------- |
| `0` | Success |
| `1` | Configuration or runtime error |
| `130` | Interrupted by Ctrl+C (`SIGINT`) |

---

# Technologies

* **Node.js** (CommonJS)
* **k6**
* **dotenv**
* **Inquirer**
