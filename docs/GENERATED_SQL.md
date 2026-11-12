# Generated SQL reference

The optional `<TABLE>_coco_autonomous_review.md` is a self-contained CoCo agent task, not one of the eight governance execution files. It instructs CoCo to execute a read-only evidence plan and is documented separately in [Snowflake CoCo review workflow](COCO_REVIEW_WORKFLOW.md).

## Execution order

The application generates eight files. Their numeric prefixes define the default review and execution order, except file 7 records Task 4 after the preceding metadata work to match the established repository format.

| File | Purpose | Principal decisions |
|---|---|---|
| 1 | Pre-checks and grants | Roles, warehouse, readers, baseline and freshness support |
| 2 | Classification | Accepted semantic/privacy categories |
| 3 | Masking | Approved `GDF_PII` tiers |
| 4 | Governance tags | Source/layer/retention, CDE and derived PII |
| 5 | Quality checks | DMF schedule, keys, null checks, freshness and expectations |
| 6 | Descriptions and terms | Table/column comments and business terms |
| 7 | Row access | Approved existing policy or explicit non-application |
| 8 | De-identification acceptance | Aggregate evidence for loader treatment and load status |

## File 1 — pre-checks and grants

This file:

- selects the governance role and warehouse;
- lists required tags and shared masking policies;
- inspects whether shared policy DDL includes the expected privileged exemptions;
- grants table `SELECT` to the governance role using the configured owner role;
- captures row-count, freshness and masked-column presence baselines;
- creates `GDF_HOURS_SINCE_UPDATE` with `IF NOT EXISTS` when a freshness column is selected;
- grants account-level DMF execution privilege to the governance role.

The final grant uses `ACCOUNTADMIN` and must be reviewed. If the privilege already exists or organizational policy forbids direct `ACCOUNTADMIN` use, remove or route it through the approved platform process.

The generator does not determine whether `PLATFORM_ADMIN` can grant access in a managed-access schema. Confirm actual ownership and grant authority.

## File 2 — classification

Classification runs with:

```sql
CALL SYSTEM$CLASSIFY('<TABLE>', {'auto_tag': false});
```

This separates detection from approval. Accepted human decisions are emitted as column assignments for:

- `SNOWFLAKE.CORE.SEMANTIC_CATEGORY`
- `SNOWFLAKE.CORE.PRIVACY_CATEGORY`

If no assignments are accepted, the file records that decision and still queries current system-tag references.

## File 3 — masking

Approved tiers are applied through `GOVERNANCE.TAGS.GDF_PII`. The application does not create or replace shared masking policies.

The file includes test queries under:

- ingest role;
- platform owner role;
- data modeler role;
- data engineer role.

It then queries `POLICY_REFERENCES` as evidence. Test results must be interpreted against the actual policy bodies; the frontend does not know their return expressions.

Rollback commands are comments and must be selected deliberately. Removing a tag can expose data, so rollback is itself a governed action.

## File 4 — governance tags

The file applies table-level:

- `SOURCE_SYSTEM`
- `LAYER`
- `RETENTION`

It applies approved column-level:

- `CDE = TRUE`
- `PII_DERIVED = TRUE`

It finishes by querying all Governance tag references on the table.

## File 5 — quality checks

The file sets `DATA_METRIC_SCHEDULE` and checks existing associations before adding:

- `SNOWFLAKE.CORE.ROW_COUNT`
- `SNOWFLAKE.CORE.DUPLICATE_COUNT`, when a key is provided
- `SNOWFLAKE.CORE.NULL_COUNT`, for each selected column
- `GOVERNANCE.POLICIES.GDF_HOURS_SINCE_UPDATE`, when a `TIMESTAMP_NTZ` freshness column is provided

`ADD DATA METRIC FUNCTION` is not treated as idempotent. Review existing associations and skip duplicates before execution.

The generated expectations are comments, not automated alerts. Alert routing and thresholds remain part of the broader governance automation.

## File 6 — descriptions and business terms

The file:

- records approved business terms in a comment for external catalogue mapping;
- assigns the table comment;
- assigns only non-empty column comments;
- runs `DESCRIBE TABLE` for evidence.

Business terms are not pushed to Collibra or another catalogue.

## File 7 — row access

When row access is not approved, the file contains no executable policy statement and records the reason.

When approved, it attaches an existing policy:

```sql
ALTER TABLE <TABLE>
ADD ROW ACCESS POLICY <POLICY> ON (<COLUMNS>);
```

The application does not create the policy body or prove that its signature matches the chosen columns. Review the policy DDL and privileged-role exemptions before attachment.

## File 8 — de-identification acceptance

The file runs as the configured ingest/owner-bypass role and returns:

- row count;
- reviewer-supplied aggregate checks;
- maximum ingestion timestamp when freshness is configured.

Because reviewer expressions are executable SQL, inspect them for correctness, cost and sensitive output. Acceptance checks should normally return aggregate counts, not raw PII.

## Idempotency and reruns

The output is deterministic, but not every Snowflake command is rerunnable without review:

- setting an existing tag generally updates its value;
- adding an already-associated DMF can fail;
- attaching an existing row-access policy can fail;
- comments replace prior comments;
- grants can already exist;
- classification can create new result metadata.

Before rerunning, compare current tags, policies, DMFs and comments with the desired state.

## SQL compilation boundary

The browser validates identifiers, required fields, column references and policy/type compatibility. It does not use a Snowflake parser or account connection. Compilation and behavior must be verified in a non-production execution window by authorized roles.
