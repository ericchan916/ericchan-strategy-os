# Contributing

Thanks for improving EricChan Strategy OS. Keep contributions local-first, small, and compatible with the existing safety boundaries.

## Local setup

Use `install.cmd` on Windows, or run `sh install.sh` on macOS and Linux. Both installers use the lockfile, preserve an existing `.env`, and run the test suite.

## Before opening a pull request

1. Start from a clean working tree and read the relevant code before editing.
2. Keep the change inside the requested scope. Do not bundle visual rewrites or unrelated refactors.
3. Run `npm test`.
4. For Ask UI changes, run `npm run ask:ui` and verify `http://127.0.0.1:5177` locally.
5. Do not commit `.env`, API keys, generated reports, opportunity-pool data, or other user-generated artifacts.

## Project boundaries

- The default remains offline. Search only runs when explicitly enabled.
- Existing projects are learning material, not default optimization targets.
- Do not alter the approved loading animation unless the issue explicitly requires it.
- Keep the local server bound to loopback addresses only.

## Pull request notes

Describe the problem, the smallest change made, test evidence, and any remaining risk. Avoid real paid API calls in automated tests.
