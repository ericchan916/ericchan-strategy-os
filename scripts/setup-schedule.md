# Windows Daily Schedule Notes

Stage 1A does not install a scheduler automatically. Use Windows Task Scheduler and point it at the local project.

Recommended daily command:

```bash
npm run daily
```

PowerShell command for a Task Scheduler action:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "cd 'E:\Codex项目\EricChan战略OS\ericchan-strategy-os'; npm run daily"
```

Suggested setup:

1. Open Windows Task Scheduler.
2. Create a basic task named `EricChan Strategy OS Daily`.
3. Trigger it once per day at a fixed review-friendly time.
4. Use `powershell.exe` as the program.
5. Use this as the argument:

```powershell
-NoProfile -ExecutionPolicy Bypass -Command "cd 'E:\Codex项目\EricChan战略OS\ericchan-strategy-os'; npm run daily"
```

Confirm success:

- Task Scheduler shows `Last Run Result` as `0x0`.
- `reports/YYYY-MM-DD.md` exists.
- `data/reports/YYYY-MM-DD.json` exists.
- `feedback/YYYY-MM-DD.md` exists.
- `npm run validate:report` passes for the current day.

Check the latest files manually:

```powershell
Get-ChildItem reports, data\reports, feedback | Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

Troubleshooting:

- Run `npm install` once before scheduling.
- Run `npm run daily` manually from the project directory first.
- If the summary says `mode=mock`, check API availability and that `.env` exists, but do not print the key.
- If validation fails, inspect `data/reports/YYYY-MM-DD.json` and fix the report quality issue before relying on the schedule.
- If a feedback file already exists, the runner preserves it and does not overwrite human notes.

Keep `.env` local and do not commit it.
