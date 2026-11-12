# Governance Script Studio

A dependency-free static web application for generating the standard eight DEV.RAW governance SQL files from a human-reviewed configuration.

## What is included

- The DEV.RAW physical schema catalogue exported from `Book 6.xlsx`.
- Search and selection across all catalogue tables.
- Live-schema additions and exclusions.
- Review-only deterministic masking suggestions.
- Human inputs for masking, CDE/derived tags, quality metrics, descriptions, row access and de-identification.
- Validation, browser-local draft saving, JSON import/export, individual SQL downloads and ZIP download.

The application does not contain the modernization/dbt repository, call an AI service, connect to Snowflake or execute generated SQL.

## Local preview

From this folder:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Netlify

Deploy this folder as its own Netlify site. It has no build command and uses `.` as the publish directory. For drag-and-drop deployment, ZIP the contents of this folder so that `index.html` is at the root of the uploaded archive.

## Review boundary

The embedded catalogue is a snapshot. Before approval, compare the selected table with current `DEV.INFORMATION_SCHEMA.COLUMNS` and record any additional or removed columns. Suggestions are never selected automatically. The generated SQL remains subject to code review and authorized Snowflake execution.
