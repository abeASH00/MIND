# CLAUDE.md

## Session memory (read first)

The user wants a running memory across chats. **Before doing anything, read
[`SESSION_MEMORY.md`](SESSION_MEMORY.md)**, and **update it before you
finish**: add a new section at the top for your session with what was
asked, what you did, the current status and the next steps. Keep personal
details (names, emails) out of it.

## Project quick facts

- MIND: a self-hosted reminder web app. Python 3.8–3.11 (works on 3.13),
  Flask + waitress, SQLite, Apprise for notifications. Entry point `MIND.py`.
- Code style (see CONTRIBUTING.md): tabs, type hints, docstrings on backend
  functions, sorted imports, compatible with Python 3.8.
- Architecture and known bugs: `docs/other_docs/codebase_atlas.md`.

## Tests

```bash
mkdir -p db
python3 -m unittest discover -s ./tests -p '*.py'
```

- Shared harness: `tests/_harness.py` (`MindTestCase`). Tests never touch
  the real `db/` folder or the PWA manifest.
- `@known_bug('BUG-NN')` marks expected failures that reproduce documented
  bugs. When you fix one, remove its marker.
