const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("open-source metadata keeps the project private to npm but publishable on GitHub", () => {
  const pkg = JSON.parse(readProjectFile("package.json"));

  assert.equal(pkg.private, true);
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.repository.url, "git+https://github.com/ericchan916/ericchan-strategy-os.git");
  assert.equal(pkg.bugs.url, "https://github.com/ericchan916/ericchan-strategy-os/issues");
  assert.equal(pkg.homepage, "https://github.com/ericchan916/ericchan-strategy-os#readme");
});

test("repository includes safe local installation entry points", () => {
  const windowsLauncher = readProjectFile("install.cmd");
  const windowsInstaller = readProjectFile("install.ps1");
  const unixInstaller = readProjectFile("install.sh");

  assert.match(windowsLauncher, /install\.ps1/i);
  assert.match(windowsInstaller, /npm\s+ci/i);
  assert.match(unixInstaller, /npm\s+ci/i);
  assert.match(windowsInstaller, /\.env\.example/i);
  assert.match(unixInstaller, /\.env\.example/i);
  assert.match(windowsInstaller, /Test-Path.*\.env/i);
  assert.match(unixInstaller, /\[\s*!\s*-f\s+"?\.env"?\s*\]/i);
});

test("repository includes license, contribution guide, and dependency-free CI verification", () => {
  const license = readProjectFile("LICENSE");
  const contributing = readProjectFile("CONTRIBUTING.md");
  const workflow = readProjectFile(".github/workflows/ci.yml");

  assert.match(license, /MIT License/i);
  assert.match(contributing, /npm test/i);
  assert.match(workflow, /npm ci/i);
  assert.match(workflow, /npm test/i);
});
