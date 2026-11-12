# User guide

## Purpose

Governance Script Studio guides a reviewer through the decisions required to produce eight Snowflake governance SQL files for one `DEV.RAW` table. It automates formatting, validation and repeatable boilerplate; it does not make governance decisions or execute SQL.

## Roles in the workflow

The exact RACI remains outside the application, but a complete review normally includes:

- a data steward or domain SME who understands the columns;
- a privacy/security reviewer who approves sensitivity and masking tiers;
- a data owner who approves critical elements and quality thresholds;
- data engineering, which confirms loader behavior and live schema;
- Snowflake governance/security engineering, which reviews and executes the scripts.

## Step 1: Catalogue and live schema

1. Search for and select the fully qualified table.
2. Copy the live-schema query from the application.
3. Run it in Snowflake using an authorized role.
4. Compare the result with the embedded catalogue.
5. Add loader-managed or newly introduced columns with **Add override**.
6. Exclude catalogue fields that no longer exist.
7. Confirm the live-schema review checkbox.

Example live query:

```sql
SELECT
    ORDINAL_POSITION,
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH,
    NUMERIC_PRECISION,
    NUMERIC_SCALE
FROM DEV.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'RAW'
  AND TABLE_NAME = '<TABLE_NAME>'
ORDER BY ORDINAL_POSITION;
```

The application deliberately resets live-schema confirmation when an included column changes.

### Optional: prefill with Snowflake CoCo

After selecting a table, the **Snowflake CoCo review handoff** appears on the Catalogue screen.

1. Select **Download CoCo review kit**.
2. Open the generated SQL file in an authorized Snowflake worksheet.
3. Review the warehouse-cost warning and run the required metadata, count and aggregate-profile sections.
4. Give CoCo the result sets and the prompt embedded at the end of the file.
5. Paste CoCo's JSON-only response directly into the handoff card, or save it as a `.json`/`.txt` file and select **Import CoCo review JSON**.
6. Apply the pasted recommendations or select the saved response file.
7. Read every import warning, compare the imported live schema and then begin the normal human review.

The import can prefill schema overrides, classification, masking, tags, quality candidates, descriptions, row-access rationale and de-identification notes. It does not import roles or approvals. `live_schema_confirmed`, `masking_review_confirmed` and `human_approved` are always reset to `false`.

See [Snowflake CoCo review workflow](COCO_REVIEW_WORKFLOW.md) for the full contract and safety boundary.

## Step 2: Classification and masking

Review every included column. The application can display deterministic prompts for common names, but it does not select them unless the reviewer explicitly clicks **Apply visible suggestions**.

For accepted Snowflake classification results, supply both:

- semantic category, such as `EMAIL`, `PHONE_NUMBER`, `POSTAL_CODE` or `DATE_OF_BIRTH`;
- privacy category: `IDENTIFIER`, `QUASI_IDENTIFIER` or `SENSITIVE`.

For tag-based masking, select one of:

| Tier | Intended review meaning |
|---|---|
| `FULL` | Most restrictive shared treatment; exact returned value depends on the matching Snowflake policy. |
| `PARTIAL_EMAIL` | Approved partial email presentation for eligible roles. |
| `PARTIAL_PHONE` | Approved partial phone presentation. |
| `PARTIAL_ZIP` | Approved partial postal-code presentation. |
| `CONDITIONAL` | Role-dependent access according to the shared policy. |

The application maps physical types to the expected shared policies:

| Physical type | Shared policy |
|---|---|
| String/Text | `GDF_MASK_STRING` |
| `DATE` | `GDF_MASK_DATE` |
| Timestamp | `GDF_MASK_TS` |
| Numeric | `GDF_MASK_NUMBER` |
| Float | `GDF_MASK_FLOAT` |

Partial tiers are limited to string columns. Boolean, Variant and unsupported types cannot be protected by these five policies; record the risk and obtain an appropriate policy rather than assuming the tag masks the value.

Enter an approved reason for every selected masking tier, then confirm that every column was reviewed.

## Step 3: Governance tags

Confirm the table-level values:

- `SOURCE_SYSTEM`
- `LAYER`
- `RETENTION`

Select column tags only after approval:

- `CDE = TRUE` for critical data elements;
- `PII_DERIVED = TRUE` for values derived from or resolvable to a person.

Do not tag every ID as a CDE. CDE is a business decision, not a naming convention.

## Step 4: Data-quality controls

Provide:

- DMF schedule;
- approved row-count baseline or a documented baseline decision;
- duplicate-key columns, only after uniqueness is proven;
- columns requiring null-count monitoring;
- a `TIMESTAMP_NTZ` freshness field, if one measures pipeline freshness;
- expected values, thresholds and escalation meaning.

Do not use a source business timestamp as pipeline freshness without documenting the difference. A quiet source can make a source timestamp look stale even when the loader ran successfully.

For append-history tables, a business ID can repeat legitimately. Prefer a proven version key or do not add `DUPLICATE_COUNT` until the history model is understood.

## Step 5: Documentation

An approved table description is required. It should state:

- business purpose;
- source system;
- row grain;
- history or snapshot behavior;
- sensitivity;
- important limitations.

Column comments are optional but should cover keys, sensitive fields, source timestamps, ingestion timestamps and non-obvious operational fields. Only completed comments are included in SQL.

Business terms are recorded as evidence for mapping in Collibra or another catalogue; the application does not call a catalogue API.

## Step 6: Controls

### Readers and execution roles

Record readers or teams that must be notified before masking tests. Verify every role and warehouse; generated `USE ROLE` statements are privileged operational instructions.

### Row access

Either:

- record why no row-access policy applies; or
- select an already-approved, fully qualified policy and the policy input columns.

The application does not create row-access policy bodies.

### De-identification

Record the approved load-time decision even when no transformation applies. Acceptance checks are aggregate SQL expressions, for example:

```sql
COUNT_IF(EMAIL IS NOT NULL AND NOT STARTSWITH(EMAIL, 'SYN-'))
```

Each check needs:

- a SQL-safe alias;
- an aggregate expression;
- an expected result or review rule.

These expressions are intentionally inserted as SQL and therefore require code review.

## Step 7: Review and generate

The validation panel checks:

- table selection;
- live-schema confirmation;
- complete masking review;
- policy/type compatibility;
- complete system-classification pairs;
- column references after overrides;
- baseline and quality expectations;
- documentation, row access and de-identification decisions;
- execution-role identifier format;
- row-policy identifier format;
- de-identification check completeness;
- final human approval.

After validation succeeds:

1. generate the eight files;
2. preview each file;
3. download individual files or the ZIP;
4. export the reviewed JSON configuration;
5. submit both SQL and JSON for repository review.

## Drafts and JSON

Drafts are stored in browser `localStorage` by table. They are not sent to a server. Clearing site data removes them.

Export JSON for review, version control or transfer to another browser. Importing JSON intentionally resets human approval, live-schema confirmation and masking-review confirmation so a new session must review the configuration again.

## Execution boundary

Generated SQL must be reviewed before Snowflake execution. In particular:

- confirm object ownership and managed-access behavior;
- confirm required roles and warehouses exist;
- confirm shared tags and policies have the expected bodies;
- inspect existing tags, policy references and DMF associations;
- execute files in order unless a reviewed runbook says otherwise;
- retain query results as evidence.
