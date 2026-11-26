# Session memory

A running log so that the next chat/session knows what happened before.
**Every session: read this first, and update it before you finish.**
Newest session on top.

---

## Session 1 — 2026-11-26 — "Operation Big MIND"

**Ask:** "Think of something that will use most of this session's tokens and
run it. It's okay if it's big or useless; we can continue later."

**What I chose:** a full audit of this repo (MIND, a self-hosted Flask
reminder app):
1. Read the whole codebase (~8k lines of Python/JS/HTML).
2. Write an exhaustive test suite.
3. Hunt bugs and prove each with a reproducing test.
4. Write a "codebase atlas" (architecture + bug report).
5. Fix the bugs.

### Status

| Step | State |
|------|-------|
| Read codebase | done |
| Test harness + 455 tests (was 11) | done, commit `f2af902` |
| 16 bugs reproduced with `@known_bug` tests | done |
| Codebase atlas `docs/other_docs/codebase_atlas.md` (+ mkdocs nav entry) | done |
| Fix all 16 bugs (markers removed, regression tests added, 467 tests green on 3.8/3.11/3.13) | done |
| Browser end-to-end tests: `tests/browser_e2e_test.py`, 32 tests (Playwright + Chromium, skipped if not installed) | done |
| Live run of the real `MIND.py` (scratch copy): DB import keep + auto-revert, hosting-change auto-revert | done, found + fixed BUG-17 |

Branch: `ccr-a5821806-a7lub3` (pushed to origin).

### How to run the tests

```bash
pip install -r requirements.txt
mkdir -p db
python3 -m unittest discover -s ./tests -p '*.py'
```

- About 30s. Passes on Python 3.8, 3.11 and 3.13.
- Tests marked `@known_bug('BUG-NN')` are expected failures: they describe
  the *correct* behaviour. Once a bug is fixed, the test reports an
  "unexpected success", which fails the run. Then remove the marker.
- `tests/_harness.py` → `MindTestCase` (temp DB per test, fake Apprise,
  `MindClock`, `FakeTimer`). Read its docstring first.
- `tests/_legacy_schemas.py` → old DB schemas v1–v7 for migration tests.
- Files starting with `_` are helpers, not tests. Run single files with
  `python3 -m unittest discover -s ./tests -p 'name_test.py'`, because the
  tests import `_harness` from the tests folder.

### Bugs found (details in the atlas) — all fixed

| ID | Severity | Summary |
|----|----------|---------|
| BUG-01 | High | Scheduler stalls forever after the soonest reminder is deleted or moved later |
| BUG-02 | High (security) | Can link other users' notification services to own reminders/templates/static reminders |
| BUG-03 | Medium | Failed save (bad service id) still saves partial changes / orphan rows |
| BUG-04 | Medium | Reminders at the same time: TypeError crash or double sends |
| BUG-05 | Medium | Monthly/yearly repeats drift (Jan 31 → Feb 28 → Mar 28 …) |
| BUG-06 | Low | Weekday repeat skips the first occurrence if the start day is selected |
| BUG-07 | High | DBs from version ≤5 (MIND before ~mid 2023) crash during migration |
| BUG-08 | Medium | Importing a non-SQLite file → 500 and the upload is left on disk |
| BUG-09 | Low | Wrong upload extension reports InvalidKeyValue, not InvalidDatabaseFile |
| BUG-10 | Low | Color validation is not anchored (`#abcdef;junk` is accepted) |
| BUG-11 | Low | Frontend checks `ApiKeyInvalid`, but the API sends `APIKeyInvalid` |
| BUG-12 | Low | Library search query is not URL-encoded (`&`, `#` break search) |
| BUG-13 | Low | `NaN`/`Infinity` as time → 500 |
| BUG-14 | Medium | Deleting a user leaves their other sessions valid → 500s |
| BUG-15 | High | `/api/notificationservices/available` crashes with current Apprise (frozenset) |
| BUG-16 | High | DB import moves the file without its WAL sidecars → imported data lost |
| BUG-17 | High | Every restart crashed: `execv(MIND.py)` needs +x, which the repo doesn't set (found in a live run) |

### Environment notes

- The repo clone was shallow; I ran `git fetch --unshallow` to dig through history.
- Python 3.8/3.11 venvs were made with `uv` in the session scratchpad
  (not persistent). Recreate with: `uv python install 3.8` then
  `uv venv --python 3.8 venv3.8 && VIRTUAL_ENV=venv3.8 uv pip install -r requirements.txt`.
- `pip install -r requirements.txt` needed `--ignore-installed blinker` in
  the cloud container (blinker was installed by Debian).

### Scheduled check-ins (set up by the user's request)

The user said: "If token full usage, continue back at 3:30am then stop at
7am" (timezone UTC+8). Two one-shot scheduled messages fire into this
session: resume at 2026-11-28 03:30 UTC+8 and stop at 07:00 UTC+8.

### Next steps (for a future session)

1. Optional: open a PR (only if the user asks). The branch has 4 commits:
   tests → atlas/memory → fixes → browser tests.
2. Optional ideas: CI workflow for this branch (the existing one only runs
   on `Development`); run the browser tests in CI; look at the time model
   (server TZ must equal browser TZ, atlas §7) — a real fix would mean
   storing true UTC epochs, which needs a DB migration.

### Notes for running the browser tests here

- Python Playwright isn't pre-installed (only the Node one). I ran
  `pip install playwright==1.63.0`; it finds the pre-installed Chromium
  in `/opt/pw-browsers` by itself. Do NOT run `playwright install`.
