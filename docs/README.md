# skcal docs

[Mintlify](https://mintlify.com) documentation for skcal — guides, CLI + MCP
install, and an API reference generated from the OpenAPI spec.

## Develop

```bash
npm run docs:dev        # from the repo root (runs `mint dev` in ./docs)
# or:
cd docs && npx mint@latest dev
```

## API reference

`docs/api-reference/openapi.json` is a copy of the worker's generated spec
(`src/worker/openapi.gen.json`). Regenerate and sync it with:

```bash
npm run docs:openapi
```

Validate the build (strict) with `cd docs && npx mint@latest validate`.
