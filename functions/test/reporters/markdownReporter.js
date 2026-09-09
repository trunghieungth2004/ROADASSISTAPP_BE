const fs = require("fs");
const path = require("path");

class MarkdownReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options || {};
    this._outDir = this._options.outputDir ||
      path.resolve(__dirname, "../../test-report");
    this._outFile = this._options.outputFile || "latest-result.md";
  }

  onRunComplete(_contexts, results) {
    try {
      const root = results.testResults || [];
      const total = results.numTotalTests;
      const passed = results.numPassedTests;
      const failed = results.numFailedTests;
      const suitesPassed = results.numPassedTestSuites;
      const suitesFailed = results.numFailedTestSuites;
      const status = failed === 0 ? "PASS" : "FAIL";
      const timestamp = new Date().toISOString();

      const lines = [];
      lines.push("# Test Run Report");
      lines.push("");
      lines.push(`- **Status:** ${status}`);
      lines.push(`- **Timestamp (UTC):** ${timestamp}`);
      lines.push(`- **Node:** ${process.version}`);
      lines.push(`- **Project:** ${process.env.GCLOUD_PROJECT || "n/a"}`);
      lines.push(`- **Tests:** ${passed}/${total} passed, ${failed} failed`);
      lines.push(
        `- **Suites:** ${suitesPassed} passed, ${suitesFailed} failed`,
      );
      lines.push("");

      const failedCases = [];
      for (const suite of root) {
        const suiteName = suite.testFilePath.replace(
          process.cwd() + path.sep, "",
        );
        const suiteFailed = suite.testResults.filter(
          (t) => t.status === "failed",
        );
        lines.push(
          `## ${suiteName} — ` +
          `${suite.testResults.length - suiteFailed.length}/` +
          `${suite.testResults.length} passed`,
        );
        if (suiteFailed.length > 0) {
          lines.push("");
          for (const t of suiteFailed) {
            lines.push(`- FAIL: ${t.title}`);
            const msg = (t.failureMessages || [])[0] || "";
            const firstLine = msg.split("\n").find(
              (l) => l.trim().length > 0,
            ) || "";
            lines.push(`  - ${firstLine.trim().slice(0, 200)}`);
            failedCases.push({suite: suiteName, title: t.title});
          }
        }
        lines.push("");
      }

      if (failedCases.length === 0) {
        lines.push("All tests passed.");
        lines.push("");
      }

      if (!fs.existsSync(this._outDir)) {
        fs.mkdirSync(this._outDir, {recursive: true});
      }
      fs.writeFileSync(
        path.join(this._outDir, this._outFile), lines.join("\n"),
      );
    } catch (err) {
      process.stdout.write(
        "[markdownReporter] onRunComplete failed: " +
        (err && err.stack || err) +
        "\n",
      );
    }
  }
}

module.exports = MarkdownReporter;
