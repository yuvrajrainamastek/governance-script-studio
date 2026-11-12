# Snowflake CoCo review workflow

## Purpose

The CoCo handoff reduces repetitive evidence collection without turning an AI recommendation into a governance decision. It sits between table selection and the existing seven-step human review.

```text
Select table
    ↓
Download table-specific review kit
    ↓
Run reviewed queries in Snowflake and ask CoCo for JSON
    ↓
Import JSON recommendations
    ↓
Governance engineer verifies and approves each section
    ↓
Generate the existing eight governance SQL files
```

The browser never calls Snowflake or CoCo. The user controls both the worksheet execution and the JSON pasted or imported back into the browser.

## Review kit contents

The downloaded filename is:

```text
DEV_RAW_<TABLE>_coco_review_kit.sql
```

It contains:

1. current-session context;
2. `DEV.INFORMATION_SCHEMA.TABLES` metadata;
3. the complete live column definition from `DEV.INFORMATION_SCHEMA.COLUMNS`;
4. an exact row-count query;
5. aggregate-only profile batches over at most 10,000 rows;
6. a CoCo instruction block and versioned JSON response contract.

The profile batches return null count, approximate distinct count and minimum/maximum rendered length. They do not select raw column values. Columns are divided into groups of 24 so wide tables do not create one unmanageably large aggregate statement.

The configured role and warehouse are emitted as commented guidance. The reviewer must use a role with `USAGE` on the database/schema and `SELECT` on the table.

## Cost and privacy review

The exact count can scan the full table. The aggregate profile queries each read up to 10,000 rows and wide tables produce multiple batches. Before execution:

- select an appropriately sized warehouse;
- inspect the query count for very wide tables;
- run only in the authorized Snowflake account;
- do not paste raw result values into CoCo;
- do not add `SELECT *` sample output to the handoff;
- retain the returned JSON according to the team's evidence-retention rules.

Aggregate statistics can still reveal information about very small populations. Treat the output as governance evidence and share it only with authorized reviewers.

## Response contract

CoCo must return one JSON object with `coco_review_version: 1` and the same fully qualified table selected in the application.

The major sections are:

| Section | Purpose |
|---|---|
| `evidence.row_count` | Exact baseline returned by the worksheet. |
| `evidence.observed_schema` | Complete live schema copied from `INFORMATION_SCHEMA.COLUMNS`. |
| `evidence.notes` | Evidence limitations or questions for a human. |
| `recommendations.object_tags` | Preliminary source, layer and retention values. |
| `recommendations.columns` | One assessment for every live column. |
| `recommendations.quality` | Candidate key, freshness and baseline notes. |
| `recommendations.row_access` | Preliminary decision/reason; policy names must not be invented. |
| `recommendations.deidentification` | Loader-treatment questions and safe aggregate acceptance checks. |
| `recommendations.review_notes` | Uncertainty and required follow-up. |

Each `recommendations.columns` item may contain:

```json
{
  "name": "EMAIL",
  "type": "TEXT",
  "nullable": "YES",
  "semantic_category": "EMAIL",
  "privacy_category": "IDENTIFIER",
  "mask_tier": "PARTIAL_EMAIL",
  "masking_reason": "Direct contact identifier",
  "cde": false,
  "pii_derived": false,
  "null_check": true,
  "comment": "Email supplied during loyalty registration",
  "rationale": "Name and type support the recommendation; confirm values and purpose",
  "confidence": "MEDIUM"
}
```

Allowed masking tiers are `FULL`, `PARTIAL_EMAIL`, `PARTIAL_PHONE`, `PARTIAL_ZIP`, `CONDITIONAL` or empty. Allowed privacy categories are `IDENTIFIER`, `QUASI_IDENTIFIER`, `SENSITIVE` or empty.

## Import behavior

The importer:

- rejects a missing or unsupported response version;
- rejects a response for a different table;
- accepts plain JSON or JSON contained in a Markdown code fence;
- accepts the response through direct paste or a local `.json`/`.txt` file;
- compares `observed_schema` with the embedded catalogue;
- creates preliminary additions/exclusions from that comparison;
- ignores unsupported masking tiers;
- ignores object-tag names other than `SOURCE_SYSTEM`, `LAYER` and `RETENTION`;
- accepts imported acceptance expressions only when they match a bounded aggregate form and contain no statement keywords or SQL delimiters;
- records missing assessments, duplicates and other concerns as visible warnings;
- stores provenance under `automation_review`.

The import can prefill the application but cannot complete it. It always resets:

```text
live_schema_confirmed = false
masking_review_confirmed = false
human_approved = false
```

## Governance engineer checklist

After import:

1. Read every warning shown in the handoff card.
2. Independently compare the imported schema with Snowflake.
3. Review every column, including fields CoCo left empty.
4. Validate business meaning with the data owner or source-system SME.
5. Verify masking tiers against actual shared policy behavior.
6. Prove any proposed key using exact duplicate queries.
7. Approve null/freshness expectations from operating history, not a single sample.
8. Confirm row-access and de-identification decisions with the responsible owners.
9. Complete the normal confirmation checkboxes.
10. Generate and code-review the eight final SQL files.

## Limitations

CoCo may make incorrect inferences from names, types or aggregate profiles. A 10,000-row profile is not proof of uniqueness, completeness, long-term thresholds, business meaning, legal classification or policy eligibility. Empty recommendations are expected when evidence is insufficient; they must be resolved by a human rather than guessed.
