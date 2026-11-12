# Governance Script Studio

Governance Script Studio is a dependency-free static web application that converts a human-reviewed governance configuration into the standard eight Snowflake SQL files used for `DEV.RAW` table onboarding.

The application contains an embedded physical catalogue of **258 `DEV.RAW` tables and 5,689 columns** sourced from `Book 6.xlsx`. It runs entirely in the browser and does not connect to Snowflake, call an AI service, execute SQL, or include the modernization/dbt repository. An optional handoff lets a user download a review kit, run it manually with Snowflake CoCo, and import CoCo's structured recommendations.

## Core principles

- **Human decisions remain human.** The application can identify names such as `EMAIL`, `PHONE`, `ZIP` or `COMMENT`, but these are review prompts and are never approved automatically.
- **The catalogue is a starting point.** A reviewer must compare the selected table with the current Snowflake schema and record additions or exclusions.
- **Generation is review-gated.** Scripts cannot be generated until live-schema review, masking review and governance approval are confirmed.
- **Output is deterministic.** The same catalogue and exported configuration produce the same SQL content.
- **No privileged runtime connection.** The browser only downloads files; authorized users execute reviewed SQL separately in Snowflake.

## What the application supports

- Search and selection across all embedded `DEV.RAW` tables.
- Optional Snowflake CoCo review-kit generation and guarded recommendation import.
- Live-schema additions and catalogue-column exclusions.
- Snowflake semantic and privacy classification assignments.
- Tag-based masking tiers: `FULL`, `PARTIAL_EMAIL`, `PARTIAL_PHONE`, `PARTIAL_ZIP` and `CONDITIONAL`.
- `CDE` and `PII_DERIVED` column tags plus table-level source/layer/retention tags.
- Row count, duplicate count, null count and timestamp freshness DMFs.
- Table comments, column comments and business-term evidence.
- Explicit row-access and de-identification decisions.
- Local draft persistence and reviewed configuration import/export.
- Individual SQL downloads and a dependency-free ZIP containing all eight scripts.

## Quick start

Run a local static server from the repository root:

```powershell
python -m http.server 8080
```

Open `http://localhost:8080`, select a table and follow the seven application steps. After table selection, optionally download the CoCo review kit and import its JSON response before beginning human review. Do not open `index.html` directly with `file://`; the browser must fetch `data/catalog.json` over HTTP.

## Generated files

For a table such as `DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION`, the application generates:

```text
1_DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION_pre_checks_and_grants-v1.1.sql
2_DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION_classify-v1.1.sql
3_DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION_mask-v1.1.sql
4_DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION_assign_tags-v1.1.sql
5_DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION_quality_checks-v1.1.sql
6_DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION_assign_business_terms-v1.1.sql
7_DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION_row_access-v1.1.sql
8_DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION_deidentification_check-v1.1.sql
```

See [Generated SQL reference](docs/GENERATED_SQL.md) for the responsibility and execution order of each file.

## Documentation

- [User guide](docs/USER_GUIDE.md) — complete browser workflow and reviewer checklist.
- [Snowflake CoCo review workflow](docs/COCO_REVIEW_WORKFLOW.md) — review-kit queries, JSON handoff and approval boundary.
- [Configuration reference](docs/CONFIGURATION_REFERENCE.md) — exported JSON fields and examples.
- [Catalogue maintenance](docs/CATALOGUE.md) — snapshot limitations, live-schema comparison and catalogue format.
- [Generated SQL reference](docs/GENERATED_SQL.md) — the eight scripts, roles, prerequisites and rollback boundaries.
- [Architecture and security](docs/ARCHITECTURE_AND_SECURITY.md) — data flow, trust boundaries and privileged-input risks.
- [Deployment](docs/DEPLOYMENT.md) — local preview and Git-connected Netlify deployment.
- [Testing](docs/TESTING.md) — completed verification and repeatable release checks.
- [Contributing](CONTRIBUTING.md) — repository workflow and change requirements.

## Repository layout

```text
.
├── index.html                 # Application structure
├── styles.css                 # Responsive visual system
├── app.js                     # State, validation, SQL generation and ZIP creation
├── data/
│   └── catalog.json           # Embedded DEV.RAW schema catalogue
├── tests/
│   └── coco-review.test.mjs   # Review-kit and guarded-import regression test
├── docs/                      # Operational and technical documentation
├── favicon.svg
├── netlify.toml               # Buildless Netlify configuration and security headers
├── CONTRIBUTING.md
└── README.md
```

## Important limitations

1. The embedded catalogue is a snapshot dated **12 November 2026**. Loader-managed fields such as `INSERTED_AT` may be absent and must be added during live-schema review.
2. Column names and types cannot prove business meaning, PII presence, uniqueness, acceptable null levels, retention, row-access requirements or de-identification policy.
3. The application validates configuration structure and generated-file completeness; it does not compile SQL against Snowflake.
4. Existing shared tags, masking policies, roles, warehouses and DMFs must exist and be authorized in the target Snowflake account.
5. Some generated commands are privileged. Every file requires code review and execution by authorized roles.
6. CoCo output is preliminary evidence and recommendations only. It can be incomplete or incorrect and never satisfies the application's review confirmations or final approval.

## Netlify

This repository is buildless. `netlify.toml` publishes the repository root (`.`), so no build command or package installation is needed. See [Deployment](docs/DEPLOYMENT.md) for the GitHub-to-Netlify process.
