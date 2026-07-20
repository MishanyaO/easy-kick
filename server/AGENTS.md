# Server guide

This file applies to everything under `server/`.

## Project

- Python 3.11+ FastAPI service managed with `uv`.
- Code in `src/easy_kick/`, tests in `tests/`. See `README.md` for setup and endpoints.
- State is intentionally in memory. Do not add persistent storage unless requested.

## Commands

Run from `server/`:

```bash
uv sync
uv run pytest -q
```

## Working guidelines

- Follow the existing module and route structure. Use async for network I/O and reuse the
  clients on `app.state` rather than creating new ones.
- Treat webhook bodies as untrusted, and keep signature verification ahead of any processing.
- Never commit `.env` or log credentials, tokens, authorization codes, or signatures.
- Preserve existing API behavior unless the task explicitly calls for a breaking change.
- Add or update tests for behavior changes, using the existing fixtures and
  `httpx.MockTransport`. Tests must not call real external services.
- Run the full suite before finishing.
