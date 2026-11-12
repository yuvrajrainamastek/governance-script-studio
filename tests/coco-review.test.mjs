import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "catalog.json"), "utf8"));
const table = catalog.tables.find(item => item.name === "DEV.RAW.DUTCHIE_LOYALTY_REGISTRATION");
assert.ok(table, "test table must be present in the embedded catalogue");

function elementStub() {
  const classes = new Set();
  return {
    value: "", checked: false, disabled: false, textContent: "", innerHTML: "", dataset: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => force === undefined ? (classes.has(name) ? classes.delete(name) : classes.add(name)) : (force ? classes.add(name) : classes.delete(name)),
      contains: name => classes.has(name)
    },
    addEventListener() {}, scrollIntoView() {}, querySelector: () => elementStub()
  };
}

const elements = new Map();
const storage = new Map();
const context = vm.createContext({
  console,
  document: {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, elementStub());
      return elements.get(selector);
    },
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => elementStub(),
    body: { appendChild() {} }
  },
  window: { scrollTo() {} },
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value)
  },
  navigator: { clipboard: { writeText: async () => {} } },
  URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  Blob,
  TextEncoder,
  setTimeout: () => 0,
  clearTimeout() {}
});

vm.runInContext(appSource, context, { filename: "app.js" });
context.testTables = catalog.tables;
const coverage = vm.runInContext(`(() => {
  let largest = 0;
  for (const table of testTables) {
    selectedTable = table;
    state = defaultState(table);
    const output = generateCocoReviewKit();
    if (!output.includes(table.name) || !output.includes("JSON CONTRACT")) throw new Error("Invalid kit for " + table.name);
    largest = Math.max(largest, output.length);
  }
  return { count: testTables.length, largest };
})()`, context);
assert.equal(coverage.count, 258);
assert.ok(coverage.largest > 0);

context.testTable = table;
vm.runInContext("selectedTable = testTable; state = defaultState(selectedTable);", context);

const kit = vm.runInContext("generateCocoReviewKit()", context);
assert.match(kit, /DEV\.RAW\.DUTCHIE_LOYALTY_REGISTRATION/);
assert.match(kit, /Aggregate-only profile batch 1 of 1/);
assert.match(kit, /JSON CONTRACT/);
assert.match(kit, /evidence\.observed_schema/);
assert.match(kit, /SnowflakeSqlExecute/);
assert.match(kit, /Do not ask the user to run SQL/);
assert.match(kit, /Execute every read-only query in the SQL EXECUTION PLAN/i);
assert.doesNotMatch(kit, /CALL SYSTEM\$CLASSIFY/);
assert.doesNotMatch(kit, /ALTER TABLE/);

const review = JSON.parse(JSON.stringify(vm.runInContext("cocoReviewContract()", context)));
review.recommendations.columns = table.columns.map(column => ({
  name: column.name, type: column.type, nullable: column.nullable,
  semantic_category: "", privacy_category: "", mask_tier: "", masking_reason: "",
  cde: false, pii_derived: false, null_check: false, comment: "", rationale: "", confidence: "LOW"
}));
review.generated_at = "2026-11-12T12:00:00Z";
review.evidence.row_count = 42;
review.evidence.observed_schema = [
  ...table.columns.map(column => ({
    ordinal_position: column.ordinal,
    column_name: column.name,
    data_type: column.type,
    is_nullable: column.nullable
  })),
  { ordinal_position: 14, column_name: "INSERTED_AT", data_type: "TIMESTAMP_NTZ", is_nullable: "YES" }
];
review.recommendations.columns.push({
  name: "INSERTED_AT", type: "TIMESTAMP_NTZ", nullable: "YES", semantic_category: "",
  privacy_category: "", mask_tier: "", masking_reason: "", cde: false,
  pii_derived: false, null_check: true, comment: "Ingestion timestamp",
  rationale: "Supports freshness monitoring", confidence: "HIGH"
});
const email = review.recommendations.columns.find(column => column.name === "EMAIL");
Object.assign(email, {
  semantic_category: "EMAIL", privacy_category: "IDENTIFIER", mask_tier: "PARTIAL_EMAIL",
  masking_reason: "Direct contact identifier", cde: true, pii_derived: false,
  null_check: true, comment: "Loyalty registration email"
});
review.recommendations.table_description = "Loyalty-program registrations submitted to Dutchie.";
review.recommendations.business_terms = ["Loyalty Registration"];
review.recommendations.quality = {
  duplicate_key: ["LOYALTYREGISTRATIONID"], freshness_column: "INSERTED_AT",
  baseline_note: "42 rows observed during preliminary review.",
  expected_notes: "Validate key uniqueness and ingestion freshness."
};
review.recommendations.row_access = { apply: false, reason: "No row segmentation requirement was evidenced.", policy_name: "", columns: [] };
review.recommendations.deidentification = {
  decision: "Confirm loader treatment with the data owner.",
  checks: [
    { alias: "email_present", expression: "COUNT_IF(EMAIL IS NOT NULL)", expected: "review baseline" },
    { alias: "unsafe", expression: "COUNT(*); DROP TABLE X", expected: "rejected" }
  ]
};

context.incompleteReview = JSON.parse(JSON.stringify(review));
context.incompleteReview.execution.sql_tool_used = false;
const incompleteMessage = vm.runInContext(`(() => {
  try { applyCocoReview(incompleteReview); return "accepted"; }
  catch (error) { return error.message; }
})()`, context);
assert.match(incompleteMessage, /did not confirm SnowflakeSqlExecute execution/);

context.testReview = review;
vm.runInContext("applyCocoReview(testReview)", context);
const imported = JSON.parse(vm.runInContext("JSON.stringify(state)", context));

assert.equal(imported.human_approved, false);
assert.equal(imported.live_schema_confirmed, false);
assert.equal(imported.masking_review_confirmed, false);
assert.equal(imported.automation_review.source, "SNOWFLAKE_COCO");
assert.equal(imported.automation_review.assessed_columns, 14);
assert.ok(imported.schema_overrides.additional_columns.some(column => column.name === "INSERTED_AT"));
assert.deepEqual(imported.quality.duplicate_key, ["LOYALTYREGISTRATIONID"]);
assert.equal(imported.quality.freshness_column, "INSERTED_AT");
assert.ok(imported.masking.some(item => item.column === "EMAIL" && item.tier === "PARTIAL_EMAIL"));
assert.ok(imported.classification.some(item => item.column === "EMAIL" && item.semantic_category === "EMAIL"));
assert.equal(imported.comments.columns.INSERTED_AT, "Ingestion timestamp");
assert.equal(imported.deidentification.checks.length, 1);
assert.equal(imported.deidentification.checks[0].alias, "email_present");
assert.ok(imported.automation_review.warnings.some(warning => warning.includes("safe aggregate expressions")));

console.log("PASS: autonomous CoCo task generation and execution-certified import workflow");
