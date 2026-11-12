# Configuration reference

## Overview

The **Export JSON** action creates the portable, human-reviewed input used by the browser generator. It contains decisions and schema overrides, not table data or Snowflake credentials.

Top-level structure:

```json
{
  "app_version": 1,
  "table": "DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION",
  "version": "1.1",
  "human_approved": true,
  "live_schema_confirmed": true,
  "masking_review_confirmed": true,
  "roles": {},
  "object_tags": {},
  "readers_to_notify": [],
  "baseline": {},
  "classification": [],
  "masking": [],
  "cde_columns": [],
  "pii_derived_columns": [],
  "quality": {},
  "comments": {},
  "business_terms": [],
  "classification_note": "",
  "row_access": {},
  "deidentification": {},
  "schema_overrides": {}
}
```

## Identity and approval fields

| Field | Description |
|---|---|
| `app_version` | Configuration format version. |
| `table` | Fully qualified table present in the embedded catalogue. |
| `version` | Version suffix placed in generated filenames and headers. |
| `human_approved` | Final browser-session approval. Reset to `false` on import. |
| `live_schema_confirmed` | Confirmation that the catalogue was compared with Snowflake. Reset on import/schema change. |
| `masking_review_confirmed` | Confirmation that every included column was reviewed. Reset on import/masking change. |

## Roles

```json
"roles": {
  "governance": "GOVERNANCE_ADMIN",
  "warehouse": "GOV_WH",
  "owner": "PLATFORM_ADMIN",
  "ingest": "SVC_INGEST_PROD",
  "data_engineer": "DATA_ENGINEER",
  "data_modeler": "DATA_MODELER"
}
```

Values must be valid unquoted Snowflake identifiers. The application does not verify that they exist or that the current user can assume them.

## Object tags and notification

```json
"object_tags": {
  "SOURCE_SYSTEM": "DUTCHIE",
  "LAYER": "RAW",
  "RETENTION": "NON_RECORD"
},
"readers_to_notify": ["DATA_STEWARD", "REPORTING_TEAM"]
```

## Baseline

```json
"baseline": {
  "expected_rows_note": "Approximately 356K rows; alert outside ±20%.",
  "extra_aggregates": []
}
```

`extra_aggregates` is reserved for reviewed SQL aggregate expressions. It is not currently exposed as a primary browser control and should be treated as privileged SQL input when imported.

## Classification

```json
"classification": [
  {
    "column": "EMAIL",
    "semantic_category": "EMAIL",
    "privacy_category": "IDENTIFIER"
  }
]
```

Both categories are required when an entry exists.

## Masking

```json
"masking": [
  {
    "column": "EMAIL",
    "tier": "PARTIAL_EMAIL",
    "reason": "Direct customer identifier"
  },
  {
    "column": "COMMENT",
    "tier": "FULL",
    "reason": "Unstructured free text may contain PII"
  }
]
```

The reason is evidence; the tier drives generated SQL. Exact masking behavior is defined by shared Snowflake policy bodies, not by this application.

## Column tags

```json
"cde_columns": ["LOYALTYREGISTRATIONID", "CUSTOMERID"],
"pii_derived_columns": ["CREATEDBYUSERID"]
```

All referenced fields must remain included after schema overrides.

## Quality

```json
"quality": {
  "schedule": "USING CRON 0 6 * * * UTC",
  "duplicate_key": ["LOYALTYREGISTRATIONID"],
  "null_count_columns": ["CUSTOMERID"],
  "freshness_column": "INSERTED_AT",
  "expected_notes": "Duplicate count 0; null count equals approved baseline; freshness under 48 hours."
}
```

`freshness_column` must be `TIMESTAMP_NTZ` because the generated custom DMF accepts that type.

## Comments and business terms

```json
"comments": {
  "table": "Dutchie loyalty registration events at one row per registration version.",
  "columns": {
    "EMAIL": "Customer email address protected with partial email masking.",
    "INSERTED_AT": "Snowflake ingestion timestamp used for pipeline freshness."
  }
},
"business_terms": ["Loyalty Registration", "Customer Consent"]
```

SQL string literals are escaped. Business terms are emitted as a one-line SQL comment and catalogue-mapping evidence.

## Row access

Not applied:

```json
"row_access": {
  "apply": false,
  "reason": "Shared RAW source; no row-filtering policy approved.",
  "policy_name": "",
  "columns": []
}
```

Applied:

```json
"row_access": {
  "apply": true,
  "reason": "Location-based access approved by the data owner.",
  "policy_name": "GOVERNANCE.POLICIES.LOCATION_ACCESS",
  "columns": ["LOCID"]
}
```

The named policy must already exist.

## De-identification

```json
"deidentification": {
  "decision": "Email is tokenized and COMMENT is nulled in the DEV loader.",
  "checks": [
    {
      "alias": "real_email_count",
      "expression": "COUNT_IF(EMAIL IS NOT NULL AND NOT STARTSWITH(EMAIL, 'SYN-'))",
      "expected": "0"
    }
  ]
}
```

Expressions are inserted as SQL and must be aggregate expressions reviewed for correctness and cost.

## Schema overrides

```json
"schema_overrides": {
  "additional_columns": [
    {
      "name": "INSERTED_AT",
      "type": "TIMESTAMP_NTZ",
      "nullable": "YES",
      "ordinal_position": 14
    }
  ],
  "excluded_catalog_columns": [],
  "review_note": "Compared with DEV.INFORMATION_SCHEMA.COLUMNS on 2026-11-12."
}
```

Removing a column through the UI also removes decisions that reference it. Imported configurations are validated again.

## Import behavior

For safety, importing a configuration resets:

- `human_approved`
- `live_schema_confirmed`
- `masking_review_confirmed`

The reviewer must repeat those confirmations before generation.
