# Local Schedule Notes

Stage 0.5 does not install a scheduler automatically.

Recommended manual command:

```bash
npm run report
```

Windows Task Scheduler can run this once per day from the project directory:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -Command "cd 'E:\Codex项目\EricChan战略OS\ericchan-strategy-os'; npm run report"
```

Keep `.env` local and do not commit it.
