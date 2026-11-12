# Testing

## Verification completed

The initial release was verified on 12 November 2026.

### Static integrity

- `app.js` passed `node --check`.
- Every JavaScript `#id` reference resolved to an element in `index.html`.
- `data/catalog.json` parsed successfully.
- The catalogue contained 258 unique tables and 5,689 columns.
- The application and catalogue returned HTTP 200 from a local static server.

### Generator and ZIP

An in-memory browser-equivalent test exercised:

- required validation;
- semantic/privacy classification;
- tag-based masking;
- CDE tags;
- row-count, duplicate, null and freshness metrics;
- table and column comments;
- explicit row-access decision;
- de-identification acceptance check;
- all eight output filenames and required sections;
- individual content completeness;
- ZIP local and central directory entries.

The realistic randomized test selected:

```text
DEV.RAW.DUTCHIE_AUTHORIZED_USERS
```

Test-only decisions included:

- `EMAIL` → semantic `EMAIL`, privacy `IDENTIFIER`;
- `EMAIL` → `PARTIAL_EMAIL`;
- a candidate ID for the duplicate-count branch;
- one null-count field;
- one timestamp for the freshness branch.

All 16 validation checks passed, eight SQL files were generated, and the ZIP contained eight entries. These synthetic selections verified software behavior and are not approved governance recommendations for the table.

### Git state

The initial application commit was pushed to `main` and the remote commit was verified.

## Release checklist

Run this checklist after changing application logic, validation, templates or the catalogue.

### 1. Syntax

```powershell
node --check app.js
```

### 2. Catalogue integrity

```powershell
@'
from pathlib import Path
import json

data = json.loads(Path('data/catalog.json').read_text(encoding='utf-8'))
tables = data['tables']
assert len(tables) == len({table['name'] for table in tables})
assert all(table['name'].startswith('DEV.RAW.') for table in tables)
assert all(table['columns'] for table in tables)
print(len(tables), sum(len(table['columns']) for table in tables))
'@ | python -
```

Update expected counts when the approved catalogue snapshot changes.

### 3. HTTP smoke test

```powershell
python -m http.server 8080
```

In another terminal:

```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:8080/).StatusCode
(Invoke-WebRequest -UseBasicParsing http://localhost:8080/data/catalog.json).StatusCode
```

Both should return `200`.

### 4. Browser workflow

Test at least:

- a small table;
- a table with more than 100 columns;
- a table with `EMAIL` or `PHONE`;
- a table requiring an added `INSERTED_AT` override;
- an unsupported Boolean or Variant masking attempt;
- exclusion of a column that already has decisions;
- JSON export and import;
- approval reset after import;
- individual SQL download;
- ZIP download.

### 5. Generated SQL review

Confirm:

- exactly eight files;
- filenames use the selected fully qualified table;
- no `undefined`, `NaN` or `[object Object]` values;
- all generated column references exist in the reviewed schema;
- comments and string literals are escaped;
- accepted classifications appear in file 2;
- masking tags appear in file 3;
- CDE/derived tags appear in file 4;
- selected DMFs appear in file 5;
- comments appear in file 6;
- row-access decision appears in file 7;
- acceptance expressions appear in file 8.

### 6. ZIP integrity

Open the archive and confirm it contains eight SQL files with readable UTF-8 content.

### 7. Repository state

```powershell
git status --short
git diff --check
```

The release should not include local drafts, credentials, raw query results or modernization project files.

## Not covered by frontend testing

The current test environment does not compile or execute SQL in Snowflake. Before operational use, an authorized reviewer must verify:

- role and warehouse availability;
- ownership and managed-access privileges;
- tag allowed values;
- masking-policy bodies and exemptions;
- policy/type signatures;
- DMF availability and signatures;
- row-access policy signature;
- SQL cost and expected results;
- downstream behavior under masked roles.
