# hackathon-digest
Daily hackathon digest log for automated email routine

## Routine spec

- **Recipients:** consoleempty@gmail.com and shyguygamedev@gmail.com (all digest emails, including test sends)
- **Selection:** pick one hackathon not already listed in `sent_log.md`
- **Email detail level** — each email must include, in this order:
  - Hackathon date(s) at the very top of the body, before anything else
  - What the featured tool/platform/theme actually is (plain-language explainer, not just the name)
  - What's required to build/submit (theme, mandatory requirements, deliverables)
  - Judging/evaluation criteria
  - Format, prize pool
  - Source links
- After sending, append a row to `sent_log.md` (date, name, URL) and commit
