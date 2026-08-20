# hackathon-digest
Daily hackathon digest log for automated email routine

## Routine spec

- **Recipients:** consoleempty@gmail.com and shyguygamedev@gmail.com (all digest emails, including test sends)
- **Selection:** pick one hackathon not already covered. Dedup is done by searching Gmail's sent folder for prior "Hackathon Digest: ..." subjects — NOT via `sent_log.md` (the routine's GitHub App has no repo write access, so it can't reliably commit/push a log; see note below)
- **Email detail level** — each email must include, in this order:
  - Hackathon date(s) at the very top of the body, before anything else
  - What the featured tool/platform/theme actually is (plain-language explainer, not just the name)
  - What's required to build/submit (theme, mandatory requirements, deliverables)
  - Judging/evaluation criteria
  - Format, prize pool
  - Source links
- No git commit/push step. `sent_log.md` below is a manual historical record only, not read or written by the automated routine.

### Known limitation
The Claude GitHub App for this repo is authorization-only (shows under GitHub's "Authorized GitHub Apps", not "Installed GitHub Apps") — there is no install/configure step available to grant it repo write access, so cloud routine runs cannot push commits. Dedup was moved to Gmail sent-history search to route around this entirely.
