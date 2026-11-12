"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE_PREFIX = "governance-script-studio:v1:";
const MASK_TIERS = ["", "FULL", "PARTIAL_EMAIL", "PARTIAL_PHONE", "PARTIAL_ZIP", "CONDITIONAL"];
const RESERVED = new Set(["COMMENT", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP"]);
const COCO_REVIEW_VERSION = 1;
const COCO_PROFILE_BATCH_SIZE = 24;

let catalogue = { tables: [] };
let selectedTable = null;
let state = null;
let generatedScripts = {};
let maskFilter = "all";
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function qid(value) {
  const upper = String(value).toUpperCase();
  return /^[A-Z_][A-Z0-9_$]*$/.test(upper) && !RESERVED.has(upper)
    ? upper
    : `"${String(value).replaceAll('"', '""')}"`;
}

function qstr(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function commentLine(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function alias(value) {
  let result = String(value).toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!result || /^\d/.test(result)) result = `VALUE_${result}`;
  return result;
}

function policyForType(type) {
  const value = String(type).toUpperCase();
  if (["TEXT", "VARCHAR", "CHAR", "CHARACTER", "STRING"].includes(value)) return "GDF_MASK_STRING";
  if (value === "DATE") return "GDF_MASK_DATE";
  if (value.startsWith("TIMESTAMP")) return "GDF_MASK_TS";
  if (["NUMBER", "DECIMAL", "NUMERIC", "INTEGER", "INT", "BIGINT", "SMALLINT"].includes(value)) return "GDF_MASK_NUMBER";
  if (["FLOAT", "DOUBLE", "DOUBLE PRECISION", "REAL"].includes(value)) return "GDF_MASK_FLOAT";
  return null;
}

function suggestionFor(column) {
  const name = column.name.toUpperCase();
  if (/(^|_)EMAIL($|_)/.test(name)) return { tier: "PARTIAL_EMAIL", reason: "Column name contains EMAIL" };
  if (/PHONE|FAX|MOBILE|CELL/.test(name)) return { tier: "PARTIAL_PHONE", reason: "Column name suggests a telephone number" };
  if (/POSTAL|ZIP/.test(name)) return { tier: "PARTIAL_ZIP", reason: "Column name suggests a postal code" };
  if (/COMMENT|NOTE|FREE.?TEXT/.test(name)) return { tier: "FULL", reason: "Free text can contain unstructured PII" };
  if (/FIRST.?NAME|LAST.?NAME|FULL.?NAME|DATE.?OF.?BIRTH|DOB|DRIVER.*LICENSE/.test(name)) return { tier: "FULL", reason: "Column name suggests a direct personal identifier" };
  return null;
}

function defaultState(table) {
  return {
    app_version: 1,
    table: table.name,
    version: "1.1",
    human_approved: false,
    live_schema_confirmed: false,
    masking_review_confirmed: false,
    roles: {
      governance: "GOVERNANCE_ADMIN", warehouse: "GOV_WH", owner: "PLATFORM_ADMIN",
      ingest: "SVC_INGEST_PROD", data_engineer: "DATA_ENGINEER", data_modeler: "DATA_MODELER"
    },
    object_tags: { SOURCE_SYSTEM: inferSourceSystem(table.name), LAYER: "RAW", RETENTION: "NON_RECORD" },
    readers_to_notify: [],
    baseline: { expected_rows_note: "", extra_aggregates: [] },
    classification: [],
    masking: [],
    cde_columns: [],
    pii_derived_columns: [],
    quality: {
      schedule: "USING CRON 0 6 * * * UTC", duplicate_key: [], null_count_columns: [],
      freshness_column: table.columns.some(column => column.name === "INSERTED_AT") ? "INSERTED_AT" : "",
      expected_notes: ""
    },
    comments: { table: "", columns: {} },
    business_terms: [],
    classification_note: "Review classification results before applying any system tags.",
    row_access: { apply: false, reason: "", policy_name: "", columns: [] },
    deidentification: { decision: "", checks: [] },
    automation_review: null,
    schema_overrides: {
      additional_columns: [], excluded_catalog_columns: [],
      review_note: "Compare the catalogue with current DEV.INFORMATION_SCHEMA.COLUMNS."
    }
  };
}

function inferSourceSystem(tableName) {
  const name = tableName.split(".").at(-1);
  if (name.startsWith("DUTCHIE_")) return "DUTCHIE";
  if (name.startsWith("ADOBE_")) return "ADOBE";
  if (name.startsWith("AZURE_")) return "AZURE";
  if (name.startsWith("LEAFLINK_")) return "LEAFLINK";
  if (name.startsWith("INFOPLUS_")) return "INFOPLUS";
  return name.split("_")[0] || "UNKNOWN";
}

function normalizeState(imported, table) {
  const base = defaultState(table);
  const merged = {
    ...base, ...imported,
    table: table.name,
    human_approved: false,
    live_schema_confirmed: false,
    masking_review_confirmed: false,
    roles: { ...base.roles, ...(imported.roles || {}) },
    object_tags: { ...base.object_tags, ...(imported.object_tags || {}) },
    baseline: { ...base.baseline, ...(imported.baseline || {}) },
    quality: { ...base.quality, ...(imported.quality || {}) },
    comments: { ...base.comments, ...(imported.comments || {}), columns: { ...(imported.comments?.columns || {}) } },
    row_access: { ...base.row_access, ...(imported.row_access || {}) },
    deidentification: { ...base.deidentification, ...(imported.deidentification || {}) },
    automation_review: imported.automation_review && typeof imported.automation_review === "object"
      ? { ...imported.automation_review }
      : null,
    schema_overrides: { ...base.schema_overrides, ...(imported.schema_overrides || {}) }
  };
  merged.masking = (merged.masking || []).map(item => ({ ...item, column: String(item.column).toUpperCase(), tier: String(item.tier).toUpperCase() }));
  merged.classification = (merged.classification || []).map(item => ({
    ...item, column: String(item.column).toUpperCase(), semantic_category: String(item.semantic_category || "").toUpperCase(),
    privacy_category: String(item.privacy_category || "").toUpperCase()
  }));
  merged.cde_columns = (merged.cde_columns || []).map(value => String(value).toUpperCase());
  merged.pii_derived_columns = (merged.pii_derived_columns || []).map(value => String(value).toUpperCase());
  merged.quality.duplicate_key = (merged.quality.duplicate_key || []).map(value => String(value).toUpperCase());
  merged.quality.null_count_columns = (merged.quality.null_count_columns || []).map(value => String(value).toUpperCase());
  merged.quality.freshness_column = String(merged.quality.freshness_column || "").toUpperCase();
  merged.row_access.columns = (merged.row_access.columns || []).map(value => String(value).toUpperCase());
  merged.comments.columns = Object.fromEntries(Object.entries(merged.comments.columns || {}).map(([key, value]) => [key.toUpperCase(), value]));
  merged.schema_overrides.excluded_catalog_columns = (merged.schema_overrides.excluded_catalog_columns || []).map(value => String(value).toUpperCase());
  merged.schema_overrides.additional_columns = (merged.schema_overrides.additional_columns || []).map(column => ({
    ...column, name: String(column.name).toUpperCase(), type: String(column.type).toUpperCase()
  }));
  return merged;
}

function currentColumns() {
  if (!selectedTable || !state) return [];
  const excluded = new Set((state.schema_overrides.excluded_catalog_columns || []).map(value => value.toUpperCase()));
  const catalogueColumns = selectedTable.columns
    .filter(column => !excluded.has(column.name))
    .map(column => ({ ...column, source: "catalogue" }));
  const additions = (state.schema_overrides.additional_columns || []).map((column, index) => ({
    name: String(column.name).toUpperCase(), type: String(column.type).toUpperCase(),
    nullable: column.nullable || "YES", ordinal: Number(column.ordinal_position || selectedTable.columns.length + index + 1),
    source: "override"
  }));
  return [...catalogueColumns, ...additions].sort((a, b) => a.ordinal - b.ordinal);
}

function getMask(columnName) {
  return state.masking.find(item => item.column === columnName) || null;
}

function getClassification(columnName) {
  return state.classification.find(item => item.column === columnName) || null;
}

function setClassification(columnName, semantic, privacy) {
  state.classification = state.classification.filter(item => item.column !== columnName);
  if (semantic || privacy) state.classification.push({ column: columnName, semantic_category: semantic || "", privacy_category: privacy || "" });
}

function removeColumnReferences(columnName) {
  state.masking = state.masking.filter(item => item.column !== columnName);
  state.classification = state.classification.filter(item => item.column !== columnName);
  state.cde_columns = state.cde_columns.filter(value => value !== columnName);
  state.pii_derived_columns = state.pii_derived_columns.filter(value => value !== columnName);
  state.quality.duplicate_key = state.quality.duplicate_key.filter(value => value !== columnName);
  state.quality.null_count_columns = state.quality.null_count_columns.filter(value => value !== columnName);
  if (state.quality.freshness_column === columnName) state.quality.freshness_column = "";
  state.row_access.columns = state.row_access.columns.filter(value => value !== columnName);
  delete state.comments.columns[columnName];
}

function setMask(columnName, tier, reason) {
  state.masking = state.masking.filter(item => item.column !== columnName);
  if (tier) state.masking.push({ column: columnName, tier, reason: reason || "" });
}

function saveState(message = "Draft saved locally") {
  if (!state) return;
  localStorage.setItem(`${STORAGE_PREFIX}${state.table}`, JSON.stringify(state));
  $("#saveStatus").textContent = message;
}

function loadSavedState(table) {
  const saved = localStorage.getItem(`${STORAGE_PREFIX}${table.name}`);
  if (!saved) return defaultState(table);
  try { return normalizeState(JSON.parse(saved), table); }
  catch { return defaultState(table); }
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}

async function copyText(text, successMessage = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(successMessage); }
  catch { toast("Clipboard access was blocked"); }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(text, fileName, type = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type }), fileName);
}

function cocoReviewContract() {
  return {
    coco_review_version: COCO_REVIEW_VERSION,
    table: state.table,
    generated_at: "<ISO-8601 timestamp>",
    evidence: {
      row_count: null,
      profile_row_limit: 10000,
      observed_schema: [],
      notes: []
    },
    recommendations: {
      table_description: "",
      business_terms: [],
      object_tags: {
        SOURCE_SYSTEM: state.object_tags.SOURCE_SYSTEM || "",
        LAYER: state.object_tags.LAYER || "RAW",
        RETENTION: state.object_tags.RETENTION || "NON_RECORD"
      },
      columns: [{
        name: "<LIVE COLUMN NAME>",
        type: "<DATA_TYPE>",
        nullable: "YES",
        semantic_category: "",
        privacy_category: "",
        mask_tier: "",
        masking_reason: "",
        cde: false,
        pii_derived: false,
        null_check: false,
        comment: "",
        rationale: "",
        confidence: "LOW"
      }],
      quality: {
        duplicate_key: [],
        freshness_column: "",
        baseline_note: "",
        expected_notes: ""
      },
      row_access: {
        apply: false,
        reason: "",
        policy_name: "",
        columns: []
      },
      deidentification: {
        decision: "",
        checks: []
      },
      review_notes: []
    }
  };
}

function cocoReviewPrompt() {
  const contract = JSON.stringify(cocoReviewContract(), null, 2).replaceAll("*/", "* /");
  return `SNOWFLAKE COCO REVIEW TASK

Review only ${state.table}. Use the metadata, exact row count and aggregate-only sample profiles returned by this worksheet. Do not expose, quote or return raw source values. Treat name-based inferences as recommendations, not facts.

Return exactly one valid JSON object matching the contract below. Do not wrap it in Markdown. Populate evidence.observed_schema from DEV.INFORMATION_SCHEMA.COLUMNS. Include one recommendations.columns entry for every live column. Use only these masking tiers: FULL, PARTIAL_EMAIL, PARTIAL_PHONE, PARTIAL_ZIP, CONDITIONAL, or an empty string. Use only these privacy categories: IDENTIFIER, QUASI_IDENTIFIER, SENSITIVE, or an empty string.

Recommend values only when supported by metadata or aggregate evidence. Put uncertainty in rationale, confidence and recommendations.review_notes. Never invent a row-access policy name, business definition, retention decision, de-identification treatment or approval. Leave unsupported values empty and explain what a human must verify.

JSON CONTRACT
${contract}`;
}

function generateCocoProfileQueries(columns) {
  const batches = [];
  for (let start = 0; start < columns.length; start += COCO_PROFILE_BATCH_SIZE) {
    const batch = columns.slice(start, start + COCO_PROFILE_BATCH_SIZE);
    const objects = batch.map(column => {
      const identifier = qid(column.name);
      return `OBJECT_CONSTRUCT_KEEP_NULL(
      'column_name', ${qstr(column.name)},
      'sample_rows', COUNT(*),
      'null_count', COUNT_IF(${identifier} IS NULL),
      'approx_distinct', APPROX_COUNT_DISTINCT(TO_VARCHAR(${identifier})),
      'min_length', MIN(IFF(${identifier} IS NULL, NULL, LENGTH(TO_VARCHAR(${identifier})))),
      'max_length', MAX(IFF(${identifier} IS NULL, NULL, LENGTH(TO_VARCHAR(${identifier}))))
    )`;
    });
    batches.push(`-- Aggregate-only profile batch ${batches.length + 1} of ${Math.ceil(columns.length / COCO_PROFILE_BATCH_SIZE)}
WITH REVIEW_SAMPLE AS (
  SELECT * FROM ${state.table} LIMIT 10000
)
SELECT ARRAY_CONSTRUCT(
  ${objects.join(",\n  ")}
) AS COLUMN_PROFILE
FROM REVIEW_SAMPLE;`);
  }
  return batches.join("\n\n");
}

function generateCocoReviewKit() {
  const [database, schema, tableName] = state.table.split(".");
  const columns = currentColumns();
  return `/*
** Governance Script Studio - Snowflake CoCo review kit
** Table: ${state.table}
** Purpose: gather metadata and aggregate evidence for a preliminary governance review.
** Boundary: this worksheet does not apply tags, policies, comments, grants or table changes.
** Cost note: the exact count and sample-profile batches query the source table. Review warehouse cost before running.
*/

-- Use a role and warehouse with USAGE on ${database}.${schema} and SELECT on ${state.table}.
-- Configured context is shown as a guide; uncomment only when your access is confirmed.
-- USE ROLE ${qid(state.roles.governance || "GOVERNANCE_ADMIN")};
-- USE WAREHOUSE ${qid(state.roles.warehouse || "GOV_WH")};

-- 1. Session and table metadata
SELECT CURRENT_TIMESTAMP() AS REVIEWED_AT, CURRENT_ROLE() AS REVIEW_ROLE, CURRENT_WAREHOUSE() AS REVIEW_WAREHOUSE;

SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, ROW_COUNT AS METADATA_ROW_COUNT,
       BYTES, CREATED, LAST_ALTERED, COMMENT
FROM ${qid(database)}.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = ${qstr(schema)} AND TABLE_NAME = ${qstr(tableName)};

-- 2. Live schema. CoCo must copy this result into evidence.observed_schema.
SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
       CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
       DATETIME_PRECISION, COLUMN_DEFAULT, COMMENT
FROM ${qid(database)}.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = ${qstr(schema)} AND TABLE_NAME = ${qstr(tableName)}
ORDER BY ORDINAL_POSITION;

-- 3. Exact baseline. This may scan the table.
SELECT COUNT(*) AS ROW_COUNT FROM ${state.table};

-- 4. Preliminary aggregate profiles. These never return raw values.
--    Each batch profiles at most ${COCO_PROFILE_BATCH_SIZE} columns over at most 10,000 rows.
${generateCocoProfileQueries(columns)}

/*
${cocoReviewPrompt()}
*/
`;
}

function parseJsonResponse(text) {
  const source = String(text || "").trim();
  if (!source) throw new Error("The selected file is empty");
  try { return JSON.parse(source); } catch { /* try common CoCo wrappers below */ }
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1].trim());
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return JSON.parse(source.slice(firstBrace, lastBrace + 1));
  throw new Error("No valid JSON object was found");
}

function reviewStringArray(value) {
  return Array.isArray(value) ? [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))] : [];
}

function normalizeObservedSchema(value) {
  if (!Array.isArray(value)) return [];
  return value.map((column, index) => ({
    name: String(column.column_name || column.COLUMN_NAME || column.name || "").trim().toUpperCase(),
    type: String(column.data_type || column.DATA_TYPE || column.type || "TEXT").trim().toUpperCase(),
    nullable: String(column.is_nullable || column.IS_NULLABLE || column.nullable || "YES").trim().toUpperCase() === "NO" ? "NO" : "YES",
    ordinal_position: Number(column.ordinal_position || column.ORDINAL_POSITION || index + 1)
  })).filter(column => column.name && column.name.length <= 255);
}

function isSafeImportedAggregate(expression) {
  const value = String(expression || "").trim();
  if (!/^(COUNT|COUNT_IF|SUM|MIN|MAX|AVG|APPROX_COUNT_DISTINCT)\s*\([\s\S]*\)$/i.test(value)) return false;
  if (/;|--|\/\*|\*\//.test(value)) return false;
  return !/\b(SELECT|FROM|UNION|INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|CALL|EXECUTE|GRANT|REVOKE)\b/i.test(value);
}

function applyCocoReview(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("CoCo output must be a JSON object");
  if (Number(payload.coco_review_version) !== COCO_REVIEW_VERSION) throw new Error(`Expected coco_review_version ${COCO_REVIEW_VERSION}`);
  const reviewTable = String(payload.table || "").trim().toUpperCase();
  if (reviewTable !== state.table) throw new Error(`This review is for ${reviewTable || "an unspecified table"}, not ${state.table}`);
  const recommendations = payload.recommendations;
  if (!recommendations || typeof recommendations !== "object") throw new Error("The recommendations object is missing");
  if (!Array.isArray(recommendations.columns)) throw new Error("recommendations.columns must be an array");

  const warnings = [];
  const observedSchema = normalizeObservedSchema(payload.evidence?.observed_schema);
  const catalogueNames = new Set(selectedTable.columns.map(column => column.name));
  const observedNames = new Set(observedSchema.map(column => column.name));
  let schemaOverrides = { ...state.schema_overrides };
  if (observedSchema.length) {
    schemaOverrides = {
      additional_columns: observedSchema.filter(column => !catalogueNames.has(column.name)),
      excluded_catalog_columns: selectedTable.columns.filter(column => !observedNames.has(column.name)).map(column => column.name),
      review_note: `CoCo review imported live schema evidence for ${observedSchema.length} columns; human verification is still required.`
    };
  } else {
    warnings.push("No observed_schema evidence was supplied; catalogue overrides were not changed.");
  }

  const reviewColumns = recommendations.columns.map(column => ({
    ...column,
    name: String(column.name || column.column_name || "").trim().toUpperCase(),
    type: String(column.type || column.data_type || "TEXT").trim().toUpperCase(),
    nullable: String(column.nullable || column.is_nullable || "YES").trim().toUpperCase() === "NO" ? "NO" : "YES"
  })).filter(column => column.name);

  const knownAfterEvidence = new Set([
    ...selectedTable.columns.filter(column => !schemaOverrides.excluded_catalog_columns.includes(column.name)).map(column => column.name),
    ...schemaOverrides.additional_columns.map(column => column.name)
  ]);
  reviewColumns.forEach((column, index) => {
    if (!knownAfterEvidence.has(column.name)) {
      schemaOverrides.additional_columns.push({
        name: column.name, type: column.type, nullable: column.nullable,
        ordinal_position: selectedTable.columns.length + schemaOverrides.additional_columns.length + index + 1
      });
      knownAfterEvidence.add(column.name);
      warnings.push(`${column.name} was added from CoCo recommendations without observed_schema evidence.`);
    }
  });

  const duplicateReviewNames = reviewColumns.map(column => column.name).filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicateReviewNames.length) warnings.push(`Duplicate column recommendations were ignored for: ${[...new Set(duplicateReviewNames)].join(", ")}.`);
  const byName = new Map(reviewColumns.map(column => [column.name, column]));
  const validColumns = [...knownAfterEvidence];
  const missingAssessments = validColumns.filter(name => !byName.has(name));
  if (missingAssessments.length) warnings.push(`${missingAssessments.length} live/included columns have no CoCo recommendation and require manual completion.`);

  const invalidTiers = reviewColumns.filter(column => column.mask_tier && !MASK_TIERS.includes(String(column.mask_tier).toUpperCase()));
  if (invalidTiers.length) warnings.push(`Unsupported masking tiers were ignored for: ${invalidTiers.map(column => column.name).join(", ")}.`);
  const privacyValues = new Set(["", "IDENTIFIER", "QUASI_IDENTIFIER", "SENSITIVE"]);
  const eligible = [...byName.values()].filter(column => knownAfterEvidence.has(column.name));
  const classification = eligible.map(column => ({
    column: column.name,
    semantic_category: String(column.semantic_category || "").trim().toUpperCase(),
    privacy_category: String(column.privacy_category || "").trim().toUpperCase()
  })).filter(item => item.semantic_category || item.privacy_category).map(item => ({
    ...item,
    privacy_category: privacyValues.has(item.privacy_category) ? item.privacy_category : ""
  }));
  const masking = eligible.filter(column => MASK_TIERS.includes(String(column.mask_tier || "").toUpperCase()) && column.mask_tier).map(column => ({
    column: column.name,
    tier: String(column.mask_tier).toUpperCase(),
    reason: String(column.masking_reason || column.rationale || "").trim()
  }));
  const columnComments = Object.fromEntries(eligible.filter(column => String(column.comment || "").trim()).map(column => [column.name, String(column.comment).trim()]));
  const qualityInput = recommendations.quality && typeof recommendations.quality === "object" ? recommendations.quality : {};
  const rowAccessInput = recommendations.row_access && typeof recommendations.row_access === "object" ? recommendations.row_access : {};
  const deidInput = recommendations.deidentification && typeof recommendations.deidentification === "object" ? recommendations.deidentification : {};
  const objectTags = recommendations.object_tags && typeof recommendations.object_tags === "object" ? recommendations.object_tags : {};
  const requestedChecks = Array.isArray(deidInput.checks) ? deidInput.checks.map(check => ({
    alias: String(check.alias || "").trim(),
    expression: String(check.expression || "").trim(),
    expected: String(check.expected ?? "").trim()
  })).filter(check => check.alias || check.expression || check.expected) : [];
  const unsafeChecks = requestedChecks.filter(check => !isSafeImportedAggregate(check.expression));
  if (unsafeChecks.length) warnings.push(`${unsafeChecks.length} de-identification check expression(s) were not recognized as safe aggregate expressions and were not imported.`);
  const safeChecks = requestedChecks.filter(check => !unsafeChecks.includes(check));
  const normalizedObjectTags = Object.fromEntries(Object.entries(objectTags).map(([key, value]) => [String(key).toUpperCase(), value]));
  const approvedObjectTags = Object.fromEntries(["SOURCE_SYSTEM", "LAYER", "RETENTION"]
    .filter(key => Object.hasOwn(normalizedObjectTags, key))
    .map(key => [key, String(normalizedObjectTags[key] || "").toUpperCase()]));
  const sanitizedEvidence = {
    row_count: payload.evidence?.row_count ?? null,
    profile_row_limit: Number(payload.evidence?.profile_row_limit) || null,
    observed_schema: observedSchema.map(column => ({
      ordinal_position: column.ordinal_position,
      column_name: column.name,
      data_type: column.type,
      is_nullable: column.nullable
    })),
    notes: reviewStringArray(payload.evidence?.notes)
  };

  const next = normalizeState({
    ...state,
    object_tags: {
      ...state.object_tags,
      ...approvedObjectTags
    },
    baseline: {
      ...state.baseline,
      expected_rows_note: String(qualityInput.baseline_note || state.baseline.expected_rows_note || "").trim()
    },
    classification,
    masking,
    cde_columns: eligible.filter(column => column.cde === true).map(column => column.name),
    pii_derived_columns: eligible.filter(column => column.pii_derived === true).map(column => column.name),
    quality: {
      ...state.quality,
      duplicate_key: reviewStringArray(qualityInput.duplicate_key).map(value => value.toUpperCase()).filter(value => knownAfterEvidence.has(value)),
      null_count_columns: eligible.filter(column => column.null_check === true).map(column => column.name),
      freshness_column: String(qualityInput.freshness_column || "").trim().toUpperCase(),
      expected_notes: String(qualityInput.expected_notes || "").trim()
    },
    comments: {
      table: String(recommendations.table_description || "").trim(),
      columns: columnComments
    },
    business_terms: reviewStringArray(recommendations.business_terms),
    classification_note: `Imported Snowflake CoCo recommendations require human review. ${reviewStringArray(recommendations.review_notes).join(" ")}`.trim(),
    row_access: {
      apply: rowAccessInput.apply === true,
      reason: String(rowAccessInput.reason || "").trim(),
      policy_name: String(rowAccessInput.policy_name || "").trim().toUpperCase(),
      columns: reviewStringArray(rowAccessInput.columns).map(value => value.toUpperCase()).filter(value => knownAfterEvidence.has(value))
    },
    deidentification: {
      decision: String(deidInput.decision || "").trim(),
      checks: safeChecks
    },
    schema_overrides: schemaOverrides,
    automation_review: {
      source: "SNOWFLAKE_COCO",
      review_version: COCO_REVIEW_VERSION,
      imported_at: new Date().toISOString(),
      generated_at: String(payload.generated_at || ""),
      assessed_columns: byName.size,
      evidence: sanitizedEvidence,
      warnings
    }
  }, selectedTable);

  state = next;
  generatedScripts = {};
  saveState("CoCo recommendations imported; human review required");
  switchStep("catalogue");
  toast(`CoCo review imported with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
}

function importCocoReview(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try { applyCocoReview(parseJsonResponse(reader.result)); }
    catch (error) { toast(`CoCo import failed: ${error.message}`); }
  };
  reader.readAsText(file);
}

function renderCocoReviewStatus() {
  const review = state?.automation_review;
  if (!review) {
    $("#cocoReviewStatusPill").textContent = "Not imported";
    $("#cocoReviewStatusPill").classList.remove("override");
    $("#cocoReviewSummary").textContent = "No CoCo review has been imported for this table.";
    $("#cocoReviewWarnings").classList.add("hidden");
    $("#cocoReviewWarnings").innerHTML = "";
    return;
  }
  const imported = new Date(review.imported_at);
  const importedLabel = Number.isNaN(imported.getTime()) ? "unknown time" : imported.toLocaleString();
  const rowCount = review.evidence?.row_count;
  const warningCount = Array.isArray(review.warnings) ? review.warnings.length : 0;
  $("#cocoReviewStatusPill").textContent = "Recommendations imported";
  $("#cocoReviewStatusPill").classList.add("override");
  $("#cocoReviewSummary").textContent = `Imported ${importedLabel} · ${review.assessed_columns || 0} columns assessed · row count ${rowCount ?? "not supplied"} · ${warningCount} warning${warningCount === 1 ? "" : "s"}. Human confirmations remain incomplete.`;
  $("#cocoReviewWarnings").classList.toggle("hidden", warningCount === 0);
  $("#cocoReviewWarnings").innerHTML = (review.warnings || []).map(warning => `<li>${escapeHtml(warning)}</li>`).join("");
}

function switchStep(step) {
  $$(".step-link").forEach(button => button.classList.toggle("active", button.dataset.step === step));
  $$(".step-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === step));
  renderStep(step);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderStep(step) {
  if (step === "catalogue") renderCatalogueDetails();
  if (!state) return;
  if (step === "masking") renderMasking();
  if (step === "tags") renderTags();
  if (step === "quality") renderQuality();
  if (step === "documentation") renderDocumentation();
  if (step === "controls") renderControls();
  if (step === "review") renderReview();
}

function renderTableResults() {
  const needle = $("#tableSearch").value.trim().toUpperCase();
  const matches = catalogue.tables.filter(table => table.name.includes(needle)).slice(0, 258);
  $("#tableResults").innerHTML = matches.map(table => `
    <button class="table-option ${selectedTable?.name === table.name ? "selected" : ""}" data-table="${escapeHtml(table.name)}" role="option">
      <strong>${escapeHtml(table.name.replace("DEV.RAW.", ""))}</strong><span>${table.columns.length} cols</span>
    </button>`).join("") || `<p class="notice">No matching tables.</p>`;
}

function selectTable(tableName, imported = null) {
  const table = catalogue.tables.find(item => item.name === tableName);
  if (!table) { toast("Table is not present in the embedded catalogue"); return; }
  selectedTable = table;
  state = imported ? normalizeState(imported, table) : loadSavedState(table);
  generatedScripts = {};
  $("#pageTitle").textContent = table.name;
  $("#exportConfigBtn").disabled = false;
  $("#copySchemaQueryBtn").disabled = false;
  $("#globalNotice").classList.remove("hidden");
  $("#globalNotice").textContent = "Book 6.xlsx is a snapshot. Confirm the live schema and add loader-managed columns before approval.";
  renderTableResults();
  renderCatalogueDetails();
  saveState("Draft loaded");
}

function renderCatalogueDetails() {
  if (!selectedTable || !state) {
    $("#schemaReviewCard").classList.add("hidden");
    $("#cocoReviewCard").classList.add("hidden");
    return;
  }
  $("#schemaReviewCard").classList.remove("hidden");
  $("#cocoReviewCard").classList.remove("hidden");
  const columns = currentColumns();
  const suggestions = columns.filter(suggestionFor);
  $("#selectedTableName").textContent = selectedTable.name;
  $("#selectedColumnCount").textContent = columns.length;
  $("#suggestionCount").textContent = suggestions.length;
  $("#overrideCount").textContent = state.schema_overrides.additional_columns.length + state.schema_overrides.excluded_catalog_columns.length;
  $("#liveSchemaConfirmed").checked = state.live_schema_confirmed;
  const needle = $("#schemaColumnFilter").value.trim().toUpperCase();
  const excluded = new Set(state.schema_overrides.excluded_catalog_columns);
  const rows = [...selectedTable.columns.map(column => ({ ...column, source: "catalogue", included: !excluded.has(column.name) })),
    ...state.schema_overrides.additional_columns.map((column, index) => ({
      name: column.name, type: column.type, nullable: column.nullable, ordinal: column.ordinal_position || selectedTable.columns.length + index + 1,
      source: "override", included: true
    }))].filter(column => column.name.includes(needle));
  $("#schemaTableBody").innerHTML = rows.map(column => `
    <tr class="${column.included ? "" : "row-muted"}" data-column="${escapeHtml(column.name)}" data-source="${column.source}">
      <td>${column.ordinal}</td><td><code>${escapeHtml(column.name)}</code></td><td><span class="type-pill">${escapeHtml(column.type)}</span></td>
      <td>${escapeHtml(column.nullable || "YES")}</td><td><span class="source-pill ${column.source === "override" ? "override" : ""}">${column.source}</span></td>
      <td><input class="schema-include" type="checkbox" ${column.included ? "checked" : ""} aria-label="Include ${escapeHtml(column.name)}"></td>
    </tr>`).join("");
  $("#schemaReviewSummary").textContent = `${columns.length} included · ${state.schema_overrides.excluded_catalog_columns.length} excluded`;
  renderCocoReviewStatus();
}

function renderMasking() {
  const needle = $("#maskColumnFilter").value.trim().toUpperCase();
  let columns = currentColumns().filter(column => column.name.includes(needle));
  if (maskFilter === "suggested") columns = columns.filter(suggestionFor);
  if (maskFilter === "selected") columns = columns.filter(column => getMask(column.name));
  $("#maskingReviewConfirmed").checked = state.masking_review_confirmed;
  $("#maskingTableBody").innerHTML = columns.map(column => {
    const suggestion = suggestionFor(column);
    const decision = getMask(column.name);
    const classification = getClassification(column.name);
    const policy = policyForType(column.type);
    const options = MASK_TIERS.map(tier => `<option value="${tier}" ${decision?.tier === tier ? "selected" : ""}>${tier || "No masking"}</option>`).join("");
    const prompt = suggestion
      ? `<span class="suggestion-pill">${suggestion.tier}</span><small>${escapeHtml(suggestion.reason)}</small>`
      : `<span class="source-pill">Manual review</span>`;
    return `<tr class="${decision ? "row-selected" : ""}" data-column="${escapeHtml(column.name)}">
      <td><code>${escapeHtml(column.name)}</code></td><td><span class="type-pill">${escapeHtml(column.type)}</span></td>
      <td>${policy ? prompt : `<span class="suggestion-pill unsupported-pill">No shared policy</span>`}</td>
      <td><input class="semantic-category" value="${escapeHtml(classification?.semantic_category || "")}" placeholder="e.g. EMAIL"></td>
      <td><select class="privacy-category">
        ${["", "IDENTIFIER", "QUASI_IDENTIFIER", "SENSITIVE"].map(value => `<option value="${value}" ${classification?.privacy_category === value ? "selected" : ""}>${value || "Not assigned"}</option>`).join("")}
      </select></td>
      <td><select class="mask-tier" ${policy ? "" : "disabled"}>${options}</select></td>
      <td><input class="mask-reason" value="${escapeHtml(decision?.reason || "")}" placeholder="Approved reason" ${decision ? "" : "disabled"}></td>
    </tr>`;
  }).join("");
}

function renderTags() {
  $("#sourceSystem").value = state.object_tags.SOURCE_SYSTEM || "";
  $("#layerTag").value = state.object_tags.LAYER || "";
  $("#retentionTag").value = state.object_tags.RETENTION || "";
  const needle = $("#tagColumnFilter").value.trim().toUpperCase();
  const columns = currentColumns().filter(column => column.name.includes(needle));
  $("#tagTableBody").innerHTML = columns.map(column => `<tr data-column="${escapeHtml(column.name)}">
    <td><code>${escapeHtml(column.name)}</code></td><td><span class="type-pill">${escapeHtml(column.type)}</span></td>
    <td><input class="cde-check" type="checkbox" ${state.cde_columns.includes(column.name) ? "checked" : ""}></td>
    <td><input class="derived-check" type="checkbox" ${state.pii_derived_columns.includes(column.name) ? "checked" : ""}></td>
  </tr>`).join("");
  $("#tagSelectionSummary").textContent = `${state.cde_columns.length} CDE · ${state.pii_derived_columns.length} derived`;
}

function checkboxOptions(columns, selected, className) {
  return columns.map(column => `<label class="check-chip"><input class="${className}" type="checkbox" value="${escapeHtml(column.name)}" ${selected.includes(column.name) ? "checked" : ""}><span>${escapeHtml(column.name)}</span></label>`).join("");
}

function renderQuality() {
  const columns = currentColumns();
  $("#dmfSchedule").value = state.quality.schedule || "";
  $("#baselineNote").value = state.baseline.expected_rows_note || "";
  $("#qualityExpected").value = state.quality.expected_notes || "";
  const timestampColumns = columns.filter(column => String(column.type).startsWith("TIMESTAMP"));
  $("#freshnessColumn").innerHTML = `<option value="">No freshness DMF</option>` + timestampColumns.map(column => `<option value="${escapeHtml(column.name)}" ${state.quality.freshness_column === column.name ? "selected" : ""}>${escapeHtml(column.name)}</option>`).join("");
  $("#duplicateKeyOptions").innerHTML = checkboxOptions(columns, state.quality.duplicate_key, "duplicate-check");
  $("#nullCountOptions").innerHTML = checkboxOptions(columns, state.quality.null_count_columns, "null-check");
}

function renderDocumentation() {
  $("#tableComment").value = state.comments.table || "";
  $("#businessTerms").value = state.business_terms.join(", ");
  const needle = $("#commentColumnFilter").value.trim().toUpperCase();
  $("#columnComments").innerHTML = currentColumns().filter(column => column.name.includes(needle)).map(column => `<label class="comment-row" data-column="${escapeHtml(column.name)}">
    <span><strong>${escapeHtml(column.name)}</strong><span>${escapeHtml(column.type)}</span></span>
    <input class="column-comment" value="${escapeHtml(state.comments.columns[column.name] || "")}" placeholder="Optional approved Snowflake comment">
  </label>`).join("");
}

function renderControls() {
  $("#readers").value = state.readers_to_notify.join(", ");
  $$('[data-role]').forEach(input => input.value = state.roles[input.dataset.role] || "");
  $("#rowAccessApply").checked = Boolean(state.row_access.apply);
  $("#rowAccessFields").classList.toggle("hidden", !state.row_access.apply);
  $("#rowPolicyName").value = state.row_access.policy_name || "";
  $("#rowAccessReason").value = state.row_access.reason || "";
  $("#rowPolicyColumns").innerHTML = currentColumns().map(column => `<option value="${escapeHtml(column.name)}" ${state.row_access.columns.includes(column.name) ? "selected" : ""}>${escapeHtml(column.name)}</option>`).join("");
  $("#deidDecision").value = state.deidentification.decision || "";
  $("#deidChecks").innerHTML = state.deidentification.checks.map((check, index) => `<div class="repeat-row" data-index="${index}">
    <label>Alias<input class="deid-alias" value="${escapeHtml(check.alias || "")}" placeholder="emails_real"></label>
    <label>SQL aggregate expression<input class="deid-expression" value="${escapeHtml(check.expression || "")}" placeholder="COUNT_IF(EMAIL IS NOT NULL)"></label>
    <label>Expected<input class="deid-expected" value="${escapeHtml(check.expected || "")}" placeholder="0"></label>
    <button class="icon-button remove-deid" type="button" aria-label="Remove check">×</button>
  </div>`).join("") || `<p class="notice">No acceptance checks added.</p>`;
}

function validateState() {
  const results = [];
  const add = (ok, message) => results.push({ ok, message });
  add(Boolean(selectedTable), "A DEV.RAW table is selected.");
  if (!state) return results;
  add(state.live_schema_confirmed, "The embedded catalogue was compared with the live Snowflake schema.");
  add(state.masking_review_confirmed, "All columns received a human masking review.");
  const columns = new Map(currentColumns().map(column => [column.name, column]));
  const invalidMasks = state.masking.filter(item => {
    const column = columns.get(item.column);
    const policy = column && policyForType(column.type);
    return !column || !policy || (item.tier.startsWith("PARTIAL_") && policy !== "GDF_MASK_STRING");
  });
  add(invalidMasks.length === 0, invalidMasks.length ? `Invalid masking decisions: ${invalidMasks.map(item => item.column).join(", ")}` : "Masking tiers are compatible with catalogue types.");
  const incompleteClassifications = state.classification.filter(item => !item.semantic_category || !item.privacy_category);
  add(incompleteClassifications.length === 0, incompleteClassifications.length ? `Classification requires both categories: ${incompleteClassifications.map(item => item.column).join(", ")}` : "Accepted classification assignments are complete.");
  const currentNames = new Set(columns.keys());
  const references = [
    ...state.classification.map(item => item.column), ...state.cde_columns, ...state.pii_derived_columns,
    ...state.quality.duplicate_key, ...state.quality.null_count_columns, ...state.row_access.columns,
    ...Object.keys(state.comments.columns)
  ];
  if (state.quality.freshness_column) references.push(state.quality.freshness_column);
  const missingReferences = [...new Set(references.filter(name => !currentNames.has(name)))];
  add(missingReferences.length === 0, missingReferences.length ? `Decisions reference excluded or missing columns: ${missingReferences.join(", ")}` : "All decisions reference included columns.");
  add(Boolean(state.baseline.expected_rows_note.trim()), "An approved row-count baseline or baseline decision is recorded.");
  add(Boolean(state.quality.expected_notes.trim()), "Expected quality-metric results are recorded.");
  add(Boolean(state.comments.table.trim()), "An approved table description is provided.");
  add(Boolean(state.row_access.reason.trim()), "The row-access decision and reason are recorded.");
  add(!state.row_access.apply || Boolean(state.row_access.policy_name.trim() && state.row_access.columns.length), "Applied row access has a policy name and policy columns.");
  add(Boolean(state.deidentification.decision.trim()), "The de-identification/load-time decision is recorded.");
  const invalidChecks = state.deidentification.checks.filter(check => !String(check.alias || "").trim() || !String(check.expression || "").trim() || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(check.alias || "")));
  add(invalidChecks.length === 0, invalidChecks.length ? "Every de-identification check needs a valid alias and aggregate SQL expression." : "De-identification acceptance checks are complete.");
  const rolesValid = Object.values(state.roles).every(value => /^[A-Za-z_][A-Za-z0-9_$]*$/.test(String(value).trim()));
  add(rolesValid, "Execution roles and warehouse use valid unquoted Snowflake identifiers.");
  const policyNameValid = !state.row_access.apply || /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*){0,2}$/.test(state.row_access.policy_name);
  add(policyNameValid, "The row-access policy name is a valid one- to three-part identifier.");
  add(state.human_approved, "Required governance and data-owner approval is confirmed.");
  return results;
}

function renderReview() {
  $("#humanApproved").checked = state.human_approved;
  const validation = validateState();
  $("#validationResults").innerHTML = validation.map(item => `<div class="validation-item ${item.ok ? "ok" : "error"}"><span class="validation-icon">${item.ok ? "✓" : "!"}</span><span>${escapeHtml(item.message)}</span></div>`).join("");
  $("#configSummary").innerHTML = `<dl>
    <div><dt>Table</dt><dd>${escapeHtml(state.table.replace("DEV.RAW.", ""))}</dd></div>
    <div><dt>Included columns</dt><dd>${currentColumns().length}</dd></div>
    <div><dt>Classification / masking</dt><dd>${state.classification.length} / ${state.masking.length}</dd></div>
    <div><dt>CDE / derived</dt><dd>${state.cde_columns.length} / ${state.pii_derived_columns.length}</dd></div>
    <div><dt>Duplicate key fields</dt><dd>${state.quality.duplicate_key.length}</dd></div>
    <div><dt>Null metrics</dt><dd>${state.quality.null_count_columns.length}</dd></div>
    <div><dt>Column comments</dt><dd>${Object.values(state.comments.columns).filter(Boolean).length}</dd></div>
    <div><dt>Row access</dt><dd>${state.row_access.apply ? "Applied" : "Not applied"}</dd></div>
  </dl>`;
  $("#generatedCard").classList.toggle("hidden", Object.keys(generatedScripts).length === 0);
  if (Object.keys(generatedScripts).length) renderGeneratedFiles();
}

function scriptHeader(number, title, runAfter) {
  return `/*
** ${number}_${state.table} - ${title}   VERSION ${state.version}
** Generated deterministically from the embedded Book 6 catalogue and human-approved browser configuration.
** Run after: ${runAfter}
** Rules  : G1 policies show real values to SVC_INGEST_PROD and PLATFORM_ADMIN;
**          G2 classify with auto_tag = false, tag after review;
**          G3 no CREATE/CLONE/REPLACE/DROP of the table, no column add/drop/change (metadata only).
** Do not edit generated SQL directly; update the exported JSON and regenerate.
*/
`;
}

function generateSqlScripts() {
  const table = state.table;
  const [database, schema, tableName] = table.split(".");
  const version = state.version;
  const roles = state.roles;
  const context = `USE ROLE ${roles.governance}; USE WAREHOUSE ${roles.warehouse};`;
  const maskedColumns = state.masking.map(item => item.column);
  const baselineParts = ["COUNT(*) AS rows_total"];
  if (state.quality.freshness_column) baselineParts.push(`MAX(${qid(state.quality.freshness_column)}) AS last_insert`);
  maskedColumns.forEach(column => baselineParts.push(`COUNT(${qid(column)}) AS ${alias(column)}_PRESENT`));
  (state.baseline.extra_aggregates || []).forEach(value => baselineParts.push(value));

  let file1 = scriptHeader(1, "Pre-checks, custom DMF and grants", "none (first script)") + `
-- SECTION 0  PRE-CHECKS AND GRANTS
${context}
SHOW TAGS LIKE 'GDF_PII' IN SCHEMA GOVERNANCE.TAGS;
SHOW TAGS IN SCHEMA GOVERNANCE.TAGS;
SHOW MASKING POLICIES LIKE 'GDF_MASK_%' IN SCHEMA GOVERNANCE.POLICIES;
SELECT policy_name, CONTAINS(ddl,'''PLATFORM_ADMIN''') AND CONTAINS(ddl,'''SVC_INGEST_PROD''') AS exempt FROM (
            SELECT 'GDF_MASK_STRING' policy_name, GET_DDL('POLICY','GOVERNANCE.POLICIES.GDF_MASK_STRING') ddl
  UNION ALL SELECT 'GDF_MASK_DATE',   GET_DDL('POLICY','GOVERNANCE.POLICIES.GDF_MASK_DATE')
  UNION ALL SELECT 'GDF_MASK_TS',     GET_DDL('POLICY','GOVERNANCE.POLICIES.GDF_MASK_TS')
  UNION ALL SELECT 'GDF_MASK_NUMBER', GET_DDL('POLICY','GOVERNANCE.POLICIES.GDF_MASK_NUMBER')
  UNION ALL SELECT 'GDF_MASK_FLOAT',  GET_DDL('POLICY','GOVERNANCE.POLICIES.GDF_MASK_FLOAT'));

USE ROLE ${roles.owner};
GRANT SELECT ON TABLE ${table} TO ROLE ${roles.governance};
  -- Notify readers before testing: ${commentLine(state.readers_to_notify.join(", ") || "none recorded")}

${context}
SELECT ${baselineParts.join(", ")}
FROM ${table};
-- Approved baseline: ${commentLine(state.baseline.expected_rows_note)}
`;
  if (state.quality.freshness_column) file1 += `
CREATE DATA METRIC FUNCTION IF NOT EXISTS GOVERNANCE.POLICIES.GDF_HOURS_SINCE_UPDATE(t TABLE(ts TIMESTAMP_NTZ))
  RETURNS NUMBER AS 'SELECT DATEDIFF(hour, MAX(ts), SYSDATE()) FROM t';
`;
  file1 += `
SHOW GRANTS TO ROLE ${roles.governance};
USE ROLE ACCOUNTADMIN;
GRANT EXECUTE DATA METRIC FUNCTION ON ACCOUNT TO ROLE ${roles.governance};
-- End of file
`;

  let file2 = scriptHeader(2, "Task 1 Classify", "1_..._pre_checks_and_grants-v1.1.sql") + `
-- SECTION 1  TASK 1 - CLASSIFY (review-gated; no automatic tags)
${context}
CALL SYSTEM$CLASSIFY('${table}', {'auto_tag': false});
SELECT SYSTEM$GET_CLASSIFICATION_RESULT('${table}');
-- Human review note: ${commentLine(state.classification_note)}
`;
  if (state.classification.length) file2 += `ALTER TABLE ${table} MODIFY\n` + state.classification.map(item =>
    `  COLUMN ${qid(item.column)} SET TAG SNOWFLAKE.CORE.SEMANTIC_CATEGORY = ${qstr(item.semantic_category)}, SNOWFLAKE.CORE.PRIVACY_CATEGORY = ${qstr(item.privacy_category)}`
  ).join(",\n") + ";\n";
  else file2 += "-- Human review approved no system classification tags for this table.\n";
  file2 += `
SELECT column_name, tag_name, tag_value
FROM TABLE(${database}.INFORMATION_SCHEMA.TAG_REFERENCES_ALL_COLUMNS('${table}','TABLE'))
WHERE tag_database = 'SNOWFLAKE' ORDER BY column_name;
-- ROLLBACK: ALTER TABLE ${table} MODIFY COLUMN <col> UNSET TAG SNOWFLAKE.CORE.SEMANTIC_CATEGORY, SNOWFLAKE.CORE.PRIVACY_CATEGORY;
-- End of file
`;

  let file3 = scriptHeader(3, "Task 2 Mask (tag-based)", "2_..._classify-v1.1.sql") + "\n-- SECTION 2  TASK 2 - MASK\n" + context + "\n";
  if (state.masking.length) {
    file3 += `ALTER TABLE ${table} MODIFY\n` + state.masking.map(item => `  COLUMN ${qid(item.column)} SET TAG GOVERNANCE.TAGS.GDF_PII = ${qstr(item.tier)}`).join(",\n") + ";\n";
    const selection = maskedColumns.map(qid).join(", ");
    file3 += `
USE ROLE ${roles.ingest}; SELECT ${selection} FROM ${table} LIMIT 5;
USE ROLE ${roles.owner}; SELECT ${selection} FROM ${table} LIMIT 5;
USE ROLE ${roles.data_modeler}; SELECT ${selection} FROM ${table} LIMIT 5;
USE ROLE ${roles.data_engineer}; SELECT ${selection} FROM ${table} LIMIT 5;
USE ROLE ${roles.governance};
SELECT policy_name, ref_column_name, tag_name FROM TABLE(${database}.INFORMATION_SCHEMA.POLICY_REFERENCES(
  REF_ENTITY_NAME => '${table}', REF_ENTITY_DOMAIN => 'TABLE'));
`;
    state.masking.forEach(item => file3 += `-- ROLLBACK: ALTER TABLE ${table} MODIFY COLUMN ${qid(item.column)} UNSET TAG GOVERNANCE.TAGS.GDF_PII;\n`);
  } else file3 += "-- Human review approved no GDF_PII masking tags for this table.\n";
  file3 += "-- End of file\n";

  const objectTags = Object.entries(state.object_tags).map(([name, value]) => `GOVERNANCE.TAGS.${qid(name)} = ${qstr(value)}`).join(", ");
  const columnTags = [
    ...state.cde_columns.map(column => `  COLUMN ${qid(column)} SET TAG GOVERNANCE.TAGS.CDE = 'TRUE'`),
    ...state.pii_derived_columns.map(column => `  COLUMN ${qid(column)} SET TAG GOVERNANCE.TAGS.PII_DERIVED = 'TRUE'`)
  ];
  let file4 = scriptHeader(4, "Task 3 Assign Tags", "3_..._mask-v1.1.sql") + `
-- SECTION 3  TASK 3 - ASSIGN TAGS
${context}
ALTER TABLE ${table} SET TAG ${objectTags};
`;
  if (columnTags.length) file4 += `ALTER TABLE ${table} MODIFY\n${columnTags.join(",\n")};\n`;
  file4 += `SELECT column_name, tag_name, tag_value
FROM TABLE(${database}.INFORMATION_SCHEMA.TAG_REFERENCES_ALL_COLUMNS('${table}','TABLE'))
WHERE tag_database = 'GOVERNANCE' ORDER BY 1,2;
-- ROLLBACK: ALTER TABLE ${table} UNSET TAG <tag>; ALTER TABLE ... MODIFY COLUMN <col> UNSET TAG <tag>;
-- End of file
`;

  let file5 = scriptHeader(5, "Task 5 Quality Checks (DMFs)", "4_..._assign_tags-v1.1.sql") + `
-- SECTION 5  TASK 5 - QUALITY CHECKS
${context}
ALTER TABLE ${table} SET DATA_METRIC_SCHEDULE = ${qstr(state.quality.schedule)};
SELECT metric_name, ref_arguments, schedule_status
FROM TABLE(${database}.INFORMATION_SCHEMA.DATA_METRIC_FUNCTION_REFERENCES(
  REF_ENTITY_NAME => '${table}', REF_ENTITY_DOMAIN => 'TABLE'));
ALTER TABLE ${table} ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.ROW_COUNT ON () EXECUTE AS ROLE ${roles.governance};
`;
  if (state.quality.duplicate_key.length) file5 += `ALTER TABLE ${table} ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.DUPLICATE_COUNT ON (${state.quality.duplicate_key.map(qid).join(", ")}) EXECUTE AS ROLE ${roles.governance};\n`;
  state.quality.null_count_columns.forEach(column => file5 += `ALTER TABLE ${table} ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.NULL_COUNT ON (${qid(column)}) EXECUTE AS ROLE ${roles.governance};\n`);
  if (state.quality.freshness_column) file5 += `ALTER TABLE ${table} ADD DATA METRIC FUNCTION GOVERNANCE.POLICIES.GDF_HOURS_SINCE_UPDATE ON (${qid(state.quality.freshness_column)}) EXECUTE AS ROLE ${roles.governance};\n`;
  file5 += `-- Approved expectations: ${commentLine(state.quality.expected_notes)}
SELECT metric_name, argument_names, value, measurement_time
FROM SNOWFLAKE.LOCAL.DATA_QUALITY_MONITORING_RESULTS
WHERE table_database=${qstr(database)} AND table_schema=${qstr(schema)} AND table_name=${qstr(tableName)}
ORDER BY measurement_time DESC;
-- ROLLBACK: ALTER TABLE ${table} DROP DATA METRIC FUNCTION <dmf> ON (<col>);
-- End of file
`;

  let file6 = scriptHeader(6, "Tasks 6/7 Describe (comments) and Business Terms", "5_..._quality_checks-v1.1.sql") + `
-- SECTION 6  TASKS 6 / 7 - DESCRIBE AND BUSINESS TERMS
-- Approved business terms for catalog mapping: ${commentLine(state.business_terms.join(", ") || "none recorded")}
USE ROLE ${roles.owner};
COMMENT ON TABLE ${table} IS ${qstr(state.comments.table)};
`;
  const columnComments = Object.entries(state.comments.columns).filter(([, value]) => String(value).trim());
  if (columnComments.length) file6 += `ALTER TABLE ${table} MODIFY\n` + columnComments.map(([column, value]) => `  COLUMN ${qid(column)} COMMENT ${qstr(value)}`).join(",\n") + ";\n";
  file6 += `DESCRIBE TABLE ${table};\n-- End of file\n`;

  let file7 = scriptHeader(7, "Task 4 Row Access", "any time after approval") + "\n-- SECTION 4  TASK 4 - ROW ACCESS\n";
  if (state.row_access.apply) file7 += `${context}
ALTER TABLE ${table} ADD ROW ACCESS POLICY ${state.row_access.policy_name} ON (${state.row_access.columns.map(qid).join(", ")});
-- Approved reason: ${commentLine(state.row_access.reason)}
-- ROLLBACK: ALTER TABLE ${table} DROP ROW ACCESS POLICY ${state.row_access.policy_name};
`;
  else file7 += `-- Not applied. Approved reason: ${commentLine(state.row_access.reason)}\n-- No SQL to run.\n`;
  file7 += "-- End of file\n";

  const deidParts = ["COUNT(*) AS rows_total", ...state.deidentification.checks.map(check => `${check.expression} AS ${alias(check.alias)}`)];
  if (state.quality.freshness_column) deidParts.push(`MAX(${qid(state.quality.freshness_column)}) AS last_insert`);
  const file8 = scriptHeader(8, "De-identification / load-status check", "approved loader treatment and a successful load") + `
-- SECTION 7  DE-IDENTIFICATION ACCEPTANCE / LOAD-STATUS CHECK
-- Approved decision: ${commentLine(state.deidentification.decision)}
${state.deidentification.checks.map(check => `-- Expected ${alias(check.alias)}: ${commentLine(check.expected || "not recorded")}`).join("\n")}
USE ROLE ${roles.ingest};
SELECT ${deidParts.join(", ")}
FROM ${table};
-- End of file
`;

  return {
    [`1_${table}_pre_checks_and_grants-v${version}.sql`]: file1,
    [`2_${table}_classify-v${version}.sql`]: file2,
    [`3_${table}_mask-v${version}.sql`]: file3,
    [`4_${table}_assign_tags-v${version}.sql`]: file4,
    [`5_${table}_quality_checks-v${version}.sql`]: file5,
    [`6_${table}_assign_business_terms-v${version}.sql`]: file6,
    [`7_${table}_row_access-v${version}.sql`]: file7,
    [`8_${table}_deidentification_check-v${version}.sql`]: file8
  };
}

function renderGeneratedFiles() {
  const entries = Object.entries(generatedScripts);
  $("#generatedFiles").innerHTML = entries.map(([name], index) => `<div class="file-card">
    <button class="preview-file" data-file="${escapeHtml(name)}" title="Preview ${escapeHtml(name)}">${escapeHtml(name)}</button>
    <button class="download-file" data-file="${escapeHtml(name)}">Download</button>
  </div>`).join("");
  if (entries.length && !$("#scriptPreview").textContent) $("#scriptPreview").textContent = entries[0][1];
}

function generate() {
  const errors = validateState().filter(item => !item.ok);
  if (errors.length) { toast(`Resolve ${errors.length} validation item${errors.length === 1 ? "" : "s"} first`); renderReview(); return; }
  generatedScripts = generateSqlScripts();
  saveState("Approved configuration saved locally");
  renderReview();
  $("#generatedCard").classList.remove("hidden");
  $("#generatedCard").scrollIntoView({ behavior: "smooth", block: "start" });
  toast("Eight SQL scripts generated");
}

function exportConfig() {
  if (!state) return;
  const safeName = state.table.replaceAll(".", "_");
  downloadText(JSON.stringify(state, null, 2) + "\n", `${safeName}_governance_config.json`, "application/json");
}

function importConfig(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      const table = catalogue.tables.find(item => item.name === String(imported.table || "").toUpperCase());
      if (!table) throw new Error("The configuration table is not present in this catalogue");
      selectTable(table.name, imported);
      toast("Configuration imported; approvals reset for review");
    } catch (error) { toast(`Import failed: ${error.message}`); }
  };
  reader.readAsText(file);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = zipDateTime();
  const u16 = (view, at, value) => view.setUint16(at, value, true);
  const u32 = (view, at, value) => view.setUint32(at, value >>> 0, true);
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0);
    u16(lv, 10, stamp.time); u16(lv, 12, stamp.date); u32(lv, 14, checksum);
    u32(lv, 18, data.length); u32(lv, 22, data.length); u16(lv, 26, nameBytes.length); u16(lv, 28, 0);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0);
    u16(cv, 12, stamp.time); u16(cv, 14, stamp.date); u32(cv, 16, checksum);
    u32(cv, 20, data.length); u32(cv, 24, data.length); u16(cv, 28, nameBytes.length);
    u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0);
  u16(ev, 8, Object.keys(files).length); u16(ev, 10, Object.keys(files).length);
  u32(ev, 12, centralSize); u32(ev, 16, offset); u16(ev, 20, 0);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function bindEvents() {
  $$(".step-link").forEach(button => button.addEventListener("click", () => switchStep(button.dataset.step)));
  $("#tableSearch").addEventListener("input", renderTableResults);
  $("#tableResults").addEventListener("click", event => {
    const button = event.target.closest("[data-table]"); if (button) selectTable(button.dataset.table);
  });
  $("#schemaColumnFilter").addEventListener("input", renderCatalogueDetails);
  $("#copySchemaQueryBtn").addEventListener("click", () => {
    if (!state) return;
    const [, schema, table] = state.table.split(".");
    copyText(`SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE\nFROM DEV.INFORMATION_SCHEMA.COLUMNS\nWHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'\nORDER BY ORDINAL_POSITION;`, "Live-schema query copied");
  });
  $("#downloadCocoKitBtn").addEventListener("click", () => {
    if (!state) return;
    const safeName = state.table.replaceAll(".", "_");
    downloadText(generateCocoReviewKit(), `${safeName}_coco_review_kit.sql`, "application/sql;charset=utf-8");
    toast("CoCo review kit downloaded");
  });
  $("#importCocoReviewBtn").addEventListener("click", () => $("#importCocoReviewInput").click());
  $("#importCocoReviewInput").addEventListener("change", event => {
    if (event.target.files[0]) importCocoReview(event.target.files[0]);
    event.target.value = "";
  });
  $("#applyCocoReviewPasteBtn").addEventListener("click", () => {
    try {
      applyCocoReview(parseJsonResponse($("#cocoReviewPaste").value));
      $("#cocoReviewPaste").value = "";
    } catch (error) { toast(`CoCo import failed: ${error.message}`); }
  });
  $("#quickAddInsertedAt").addEventListener("click", () => {
    if (currentColumns().some(column => column.name === "INSERTED_AT")) return toast("INSERTED_AT is already included");
    state.schema_overrides.additional_columns.push({ name: "INSERTED_AT", type: "TIMESTAMP_NTZ", nullable: "YES", ordinal_position: currentColumns().length + 1 });
    state.live_schema_confirmed = false; saveState(); renderCatalogueDetails();
  });
  $("#addColumnForm").addEventListener("submit", event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const name = String(data.get("name")).trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_$]*$/.test(name)) return toast("Use a valid Snowflake column name");
    if (currentColumns().some(column => column.name === name)) return toast("That column is already included");
    state.schema_overrides.additional_columns.push({ name, type: data.get("type"), nullable: data.get("nullable"), ordinal_position: currentColumns().length + 1 });
    state.live_schema_confirmed = false; event.currentTarget.reset(); saveState(); renderCatalogueDetails();
  });
  $("#schemaTableBody").addEventListener("change", event => {
    if (!event.target.classList.contains("schema-include")) return;
    const row = event.target.closest("tr"); const name = row.dataset.column;
    if (row.dataset.source === "override" && !event.target.checked) {
      state.schema_overrides.additional_columns = state.schema_overrides.additional_columns.filter(column => column.name !== name);
      removeColumnReferences(name);
    } else if (row.dataset.source === "catalogue") {
      state.schema_overrides.excluded_catalog_columns = event.target.checked
        ? state.schema_overrides.excluded_catalog_columns.filter(column => column !== name)
        : [...new Set([...state.schema_overrides.excluded_catalog_columns, name])];
      if (!event.target.checked) removeColumnReferences(name);
    }
    state.live_schema_confirmed = false; saveState(); renderCatalogueDetails();
  });
  $("#liveSchemaConfirmed").addEventListener("change", event => { state.live_schema_confirmed = event.target.checked; saveState(); });

  $$("[data-mask-filter]").forEach(button => button.addEventListener("click", () => {
    maskFilter = button.dataset.maskFilter; $$("[data-mask-filter]").forEach(item => item.classList.toggle("active", item === button)); renderMasking();
  }));
  $("#maskColumnFilter").addEventListener("input", renderMasking);
  $("#applySuggestionsBtn").addEventListener("click", () => {
    let applied = 0;
    currentColumns().filter(column => column.name.includes($("#maskColumnFilter").value.trim().toUpperCase())).forEach(column => {
      const suggestion = suggestionFor(column);
      if (suggestion && policyForType(column.type) && !getMask(column.name)) { setMask(column.name, suggestion.tier, suggestion.reason); applied++; }
    });
    state.masking_review_confirmed = false; saveState(); renderMasking(); toast(`${applied} suggestion${applied === 1 ? "" : "s"} applied for human review`);
  });
  $("#maskingTableBody").addEventListener("change", event => {
    const row = event.target.closest("tr"); if (!row) return;
    if (event.target.classList.contains("mask-tier")) {
      const suggestion = suggestionFor(currentColumns().find(column => column.name === row.dataset.column));
      const reason = row.querySelector(".mask-reason").value || suggestion?.reason || "";
      setMask(row.dataset.column, event.target.value, reason); state.masking_review_confirmed = false; saveState(); renderMasking();
    }
    if (event.target.classList.contains("privacy-category")) {
      const semantic = row.querySelector(".semantic-category").value.trim().toUpperCase();
      setClassification(row.dataset.column, semantic, event.target.value); state.masking_review_confirmed = false; saveState();
    }
  });
  $("#maskingTableBody").addEventListener("input", event => {
    const name = event.target.closest("tr")?.dataset.column; if (!name) return;
    if (event.target.classList.contains("mask-reason")) { const item = getMask(name); if (item) item.reason = event.target.value; }
    if (event.target.classList.contains("semantic-category")) {
      const privacy = event.target.closest("tr").querySelector(".privacy-category").value;
      setClassification(name, event.target.value.trim().toUpperCase(), privacy); state.masking_review_confirmed = false;
    }
    saveState();
  });
  $("#maskingReviewConfirmed").addEventListener("change", event => { state.masking_review_confirmed = event.target.checked; saveState(); });

  ["sourceSystem", "layerTag", "retentionTag"].forEach((id, index) => $("#" + id).addEventListener("input", event => {
    state.object_tags[["SOURCE_SYSTEM", "LAYER", "RETENTION"][index]] = event.target.value.toUpperCase(); saveState();
  }));
  $("#tagColumnFilter").addEventListener("input", renderTags);
  $("#tagTableBody").addEventListener("change", event => {
    const row = event.target.closest("tr"); if (!row) return; const name = row.dataset.column;
    if (event.target.classList.contains("cde-check")) state.cde_columns = event.target.checked ? [...new Set([...state.cde_columns, name])] : state.cde_columns.filter(value => value !== name);
    if (event.target.classList.contains("derived-check")) state.pii_derived_columns = event.target.checked ? [...new Set([...state.pii_derived_columns, name])] : state.pii_derived_columns.filter(value => value !== name);
    saveState(); renderTags();
  });

  $("#dmfSchedule").addEventListener("input", event => { state.quality.schedule = event.target.value; saveState(); });
  $("#freshnessColumn").addEventListener("change", event => { state.quality.freshness_column = event.target.value; saveState(); });
  $("#baselineNote").addEventListener("input", event => { state.baseline.expected_rows_note = event.target.value; saveState(); });
  $("#qualityExpected").addEventListener("input", event => { state.quality.expected_notes = event.target.value; saveState(); });
  $("#duplicateKeyOptions").addEventListener("change", event => {
    if (!event.target.classList.contains("duplicate-check")) return;
    state.quality.duplicate_key = event.target.checked ? [...new Set([...state.quality.duplicate_key, event.target.value])] : state.quality.duplicate_key.filter(value => value !== event.target.value); saveState();
  });
  $("#nullCountOptions").addEventListener("change", event => {
    if (!event.target.classList.contains("null-check")) return;
    state.quality.null_count_columns = event.target.checked ? [...new Set([...state.quality.null_count_columns, event.target.value])] : state.quality.null_count_columns.filter(value => value !== event.target.value); saveState();
  });

  $("#tableComment").addEventListener("input", event => { state.comments.table = event.target.value; saveState(); });
  $("#businessTerms").addEventListener("input", event => { state.business_terms = event.target.value.split(",").map(value => value.trim()).filter(Boolean); saveState(); });
  $("#commentColumnFilter").addEventListener("input", renderDocumentation);
  $("#columnComments").addEventListener("input", event => {
    if (!event.target.classList.contains("column-comment")) return;
    const name = event.target.closest(".comment-row").dataset.column;
    if (event.target.value.trim()) state.comments.columns[name] = event.target.value; else delete state.comments.columns[name]; saveState();
  });

  $("#readers").addEventListener("input", event => { state.readers_to_notify = event.target.value.split(",").map(value => value.trim()).filter(Boolean); saveState(); });
  $$('[data-role]').forEach(input => input.addEventListener("input", event => { state.roles[event.target.dataset.role] = event.target.value.toUpperCase(); saveState(); }));
  $("#rowAccessApply").addEventListener("change", event => { state.row_access.apply = event.target.checked; saveState(); renderControls(); });
  $("#rowPolicyName").addEventListener("input", event => { state.row_access.policy_name = event.target.value.toUpperCase(); saveState(); });
  $("#rowPolicyColumns").addEventListener("change", event => { state.row_access.columns = [...event.target.selectedOptions].map(option => option.value); saveState(); });
  $("#rowAccessReason").addEventListener("input", event => { state.row_access.reason = event.target.value; saveState(); });
  $("#deidDecision").addEventListener("input", event => { state.deidentification.decision = event.target.value; saveState(); });
  $("#addDeidCheck").addEventListener("click", () => { state.deidentification.checks.push({ alias: "", expression: "", expected: "" }); saveState(); renderControls(); });
  $("#deidChecks").addEventListener("input", event => {
    const row = event.target.closest(".repeat-row"); if (!row) return; const check = state.deidentification.checks[Number(row.dataset.index)];
    if (event.target.classList.contains("deid-alias")) check.alias = event.target.value;
    if (event.target.classList.contains("deid-expression")) check.expression = event.target.value;
    if (event.target.classList.contains("deid-expected")) check.expected = event.target.value;
    saveState();
  });
  $("#deidChecks").addEventListener("click", event => {
    const button = event.target.closest(".remove-deid"); if (!button) return;
    state.deidentification.checks.splice(Number(button.closest(".repeat-row").dataset.index), 1); saveState(); renderControls();
  });

  $("#humanApproved").addEventListener("change", event => { state.human_approved = event.target.checked; saveState(); renderReview(); });
  $("#generateBtn").addEventListener("click", generate);
  $("#exportConfigBtn").addEventListener("click", exportConfig);
  $("#importConfigBtn").addEventListener("click", () => $("#importConfigInput").click());
  $("#importConfigInput").addEventListener("change", event => { if (event.target.files[0]) importConfig(event.target.files[0]); event.target.value = ""; });
  $("#generatedFiles").addEventListener("click", event => {
    const button = event.target.closest("[data-file]"); if (!button) return; const name = button.dataset.file;
    if (button.classList.contains("download-file")) downloadText(generatedScripts[name], name, "application/sql;charset=utf-8");
    else $("#scriptPreview").textContent = generatedScripts[name];
  });
  $("#downloadZipBtn").addEventListener("click", () => {
    const folder = state.table.replaceAll(".", "-"); downloadBlob(createZip(generatedScripts), `${folder}_governance_scripts_v${state.version}.zip`);
  });
}

async function initialize() {
  bindEvents();
  try {
    const response = await fetch("data/catalog.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalogue = await response.json();
    const columnCount = catalogue.tables.reduce((sum, table) => sum + table.columns.length, 0);
    $("#catalogTableCount").textContent = `${catalogue.tables.length} DEV.RAW tables`;
    $("#catalogColumnCount").textContent = `${columnCount.toLocaleString()} catalogue columns`;
    renderTableResults();
  } catch (error) {
    $("#globalNotice").classList.remove("hidden");
    $("#globalNotice").textContent = `Could not load the embedded catalogue: ${error.message}. Serve this folder over HTTP instead of opening index.html directly.`;
  }
}

document.addEventListener("DOMContentLoaded", initialize);
