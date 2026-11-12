# Autonomous Snowflake CoCo review workflow

## Purpose

The CoCo handoff automates evidence collection and preliminary field completion. There is no human relay between giving CoCo the task and receiving its completed JSON.

```text
Select table
    ↓
Download autonomous CoCo task
    ↓
Give task to CoCo Agent mode
    ↓
CoCo executes read-only SQL and produces completed JSON
    ↓
Import JSON and begin human governance review
    ↓
Generate the existing eight governance SQL files
```

The browser itself never connects to Snowflake or calls CoCo. The single file handoff starts the autonomous portion; the next user action is importing or pasting CoCo's completed response for review.

## Required CoCo capability

Use Snowflake CoCo in Agent mode with:

- an active Snowflake connection;
- a current warehouse;
- `USAGE` on the selected database and schema;
- `SELECT` on the selected table;
- access to the `SnowflakeSqlExecute` tool.

Snowflake documents that CoCo's Snowflake tools can execute SQL directly and that Agent mode has SQL-execution capability. Plan mode also permits read-only SQL, but the generated task explicitly requests Agent mode so it can optionally save the finished JSON file.

Official references:

- [CoCo CLI agent tools](https://docs.snowflake.com/en/user-guide/cortex-code/tools)
- [Agent mode and Plan mode](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-desktop/agent-mode-and-plan-mode)
- [CoCo CLI reference](https://docs.snowflake.com/en/user-guide/cortex-code/cli-reference)

## Generated task

The downloaded filename is:

```text
DEV_RAW_<TABLE>_coco_autonomous_review.md
```

Give the entire Markdown file to CoCo. Its instructions require CoCo to:

1. use `SnowflakeSqlExecute` itself;
2. execute every query in the embedded SQL plan;
3. retain the result sets in its working context;
4. retry failed queries only with read-only corrections;
5. avoid DDL, DML, grants and metadata changes;
6. avoid selecting or returning raw source values;
7. produce one assessment for every live column;
8. return only the completed version-2 JSON object;
9. save the same JSON to its workspace when file-write tools are available.

The user does not run the queries, click **Run**, copy result grids or answer questions between these steps.

## SQL evidence plan

The task contains:

1. current session context;
2. `INFORMATION_SCHEMA.TABLES` metadata;
3. the complete live schema from `INFORMATION_SCHEMA.COLUMNS`;
4. an exact row count;
5. aggregate profiles in batches of at most 24 columns over at most 10,000 rows.

The profiles return null count, approximate distinct count and minimum/maximum rendered length. They do not return raw column values.

The embedded catalogue is only the starting point for profile construction. CoCo is instructed to diagnose schema drift with the executed live-schema result and use read-only corrections. Its final column assessments must match the live schema, not merely the snapshot.

## Completion certificate

The response contract is version 2. It includes:

```json
{
  "coco_review_version": 2,
  "table": "DEV.RAW.<TABLE>",
  "status": "COMPLETE",
  "execution": {
    "mode": "AGENT",
    "sql_tool": "SnowflakeSqlExecute",
    "sql_tool_used": true,
    "queries_planned": 5,
    "queries_succeeded": 5,
    "failed_queries": []
  }
}
```

The numbers vary by table width. CoCo must update them to the queries it actually ran, including any read-only corrections.

The frontend rejects the response unless:

- `status` is `COMPLETE`;
- `sql_tool_used` is `true`;
- planned and successful query counts are equal;
- `failed_queries` is empty;
- exact row-count evidence exists;
- live-schema evidence exists;
- every live column has exactly one recommendation;
- there are no recommendations for columns absent from the executed schema;
- masking tiers and privacy categories use supported values.

This prevents a name-only response from being presented as an executed review.

## Recommendation contents

After successful execution, CoCo returns:

- observed live schema and exact row count;
- preliminary classification and masking recommendations;
- CDE and derived-PII candidates;
- duplicate-key, null and freshness candidates;
- table and column description drafts;
- business-term candidates;
- row-access rationale;
- de-identification questions and bounded aggregate checks;
- confidence and rationale for each live column;
- unresolved questions in review notes.

CoCo is instructed to leave unsupported decisions empty rather than inventing them. In particular, it must not invent policy names, legal classifications, retention approvals or loader behavior.

## Import and human review

Paste CoCo's JSON into the handoff card or import the JSON file saved by CoCo. The importer validates the completion certificate, table, schema coverage and supported values before prefilling the application.

The import is the beginning of human review, not the end. These fields always remain false:

```text
live_schema_confirmed = false
masking_review_confirmed = false
human_approved = false
```

The governance engineer reviews CoCo's completed output, corrects it where necessary, obtains required owner/privacy approvals and then generates the eight final SQL files.

## Cost and privacy

The exact count can scan the full table. Each profile query reads up to 10,000 rows, and wide tables require multiple profile batches. CoCo uses the currently selected Snowflake warehouse, so warehouse sizing and query limits remain operational prerequisites.

Aggregate statistics can reveal information about very small populations. Treat the JSON as governance evidence. Do not modify the task to return samples or raw values, and retain the result according to the team's approved evidence process.

## Failure behavior

If CoCo cannot access the table, lacks a warehouse, reaches a timeout or cannot complete a profile, it must return `status: "BLOCKED"` and identify the failed query. The frontend deliberately refuses to import that response as a completed review. Resolve the Snowflake access or execution issue and give the same task to CoCo again.
