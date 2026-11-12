# Contributing

## Development model

Governance Script Studio is intentionally buildless and dependency-free. Changes should preserve the ability to deploy the repository directly to Netlify without `npm install`, a build command or a backend service.

## Before changing code

1. Read [Architecture and security](docs/ARCHITECTURE_AND_SECURITY.md).
2. Preserve the boundary between physical catalogue facts and human governance decisions.
3. Do not automatically apply name-based masking or classification suggestions.
4. Do not add Snowflake credentials, API tokens, user data or sample PII to the repository.

## Local workflow

```powershell
git checkout main
git pull --ff-only
python -m http.server 8080
```

Open `http://localhost:8080` and exercise a representative table.

## Required checks

Run JavaScript syntax validation:

```powershell
node --check app.js
node tests/coco-review.test.mjs
```

Confirm the static site and catalogue load over HTTP:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8080/
Invoke-WebRequest -UseBasicParsing http://localhost:8080/data/catalog.json
```

Then complete the checklist in [Testing](docs/TESTING.md).

## Change requirements

- Update documentation when fields, validations or generated SQL change.
- Keep generated SQL metadata-only unless a reviewed requirement explicitly changes the boundary.
- Escape SQL literals and one-line SQL comments.
- Validate any user input interpolated as an identifier.
- Preserve JSON import compatibility when possible.
- Keep CoCo output untrusted: table/version binding, warnings and approval resets must remain enforced.
- Do not add raw-value sampling to the CoCo review kit.
- Increment `app_version` when making an incompatible configuration change.
- Verify all eight generated scripts and the ZIP downloader.
- Do not commit browser-local draft data.

## Catalogue changes

Catalogue updates must include their source date and counts, and must be reviewed for removed or renamed objects. Follow [Catalogue maintenance](docs/CATALOGUE.md).

## Commit style

Use concise imperative commit subjects, for example:

```text
Document governance review workflow
Add Boolean-policy validation warning
Refresh DEV RAW catalogue snapshot
```
