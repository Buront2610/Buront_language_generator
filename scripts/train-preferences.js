"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
function pythonExecutable(env = process.env, platform = process.platform) {
  return env.BURONT_PYTHON || path.join(root, ".venv", platform === "win32" ? "Scripts/python.exe" : "bin/python");
}

function trainPreferences(args, { env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  // Keep executable and arguments separate: paths with spaces and shell syntax
  // must reach Python unchanged. Relative input/output paths retain caller cwd.
  return spawn(pythonExecutable(env, platform), [path.join(root, "services/japanese-analysis/train_preferences.py"), ...args], {
    env, stdio: "inherit", windowsHide: true, shell: false,
  });
}

if (require.main === module) {
  const result = trainPreferences(process.argv.slice(2));
  if (result.error) console.error(`Cannot start preference trainer: ${result.error.message}. Set BURONT_PYTHON to a Python executable or set up the local .venv.`);
  process.exitCode = result.status ?? 1;
}

module.exports = { pythonExecutable, trainPreferences };
