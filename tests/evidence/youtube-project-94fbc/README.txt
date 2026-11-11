Source commit: 94fbc291a44e662059e9fa1676a44f9ccec2b1b9
Execution environment: managed Linux; CHROMIUM_PATH=/usr/bin/chromium; synthetic fixtures, PGlite and browser mocks. No real email or production writes.
Full command, from source root:
  CHROMIUM_PATH=/usr/bin/chromium npm test > /tmp/sanji-final-rerun.log 2>&1
The command runs the initial 10-test group, the 1,644-test normal suite and, if successful, npm run test:youtube-manual-mail (55 tests). See full-regression.log for original output and five skips.
Targeted command, from source root:
  CHROMIUM_PATH=/usr/bin/chromium node --test --test-concurrency=1 tests/creator-manual-notes-inbox.test.cjs tests/inbox-compact-ui.test.cjs tests/inbox-conversation-status.test.cjs tests/inbox-review-browser.test.cjs tests/inbox-review-integration.test.cjs tests/youtube-inbox-project.test.cjs tests/youtube-inbox-project-ui.test.cjs tests/youtube-project-provenance-sql.test.cjs tests/youtube-manual-no-gmail.test.cjs > /tmp/sanji-project-final-targeted.log 2>&1
See project-targeted.log for original output; project provenance SQL tests use PGlite, not a remote production PostgreSQL database.
