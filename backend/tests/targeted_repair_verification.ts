/**
 * Targeted Repair Verification Suite
 * Verifies:
 * 1. AI Provider Real Health Probing & Error Classification
 * 2. Arbitrary Table Selection Removal (Unmatched queries do NOT pick available_tables[0])
 * 3. Complete AST Column & Table Validation
 * 4. Corrected SQL Validation Equivalence
 * 5. Strict User and Project Isolation
 */

import axios from "axios";
import { SchemaService } from "../src/services/schemaService.js";
import { DatabaseManager } from "../src/config/db.js";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";
const BASE_URL = `${AI_SERVICE_URL}/api/ai`;

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    console.error(`❌ FAIL: ${name} -> ${err.message}`);
  }
}

async function run(): Promise<void> {
  console.log("===============================================================");
  console.log("🎯 RUNNING TARGETED REPAIR VERIFICATION SUITE");
  console.log("===============================================================\n");

  await DatabaseManager.initialize();

  // Test 1: Provider Health Check makes real request and returns responsive probe
  await test("Provider status returns real health evaluation (not just client init)", async () => {
    const res = await axios.get(`${BASE_URL}/provider-status`);
    assert(res.status === 200, "Should return 200");
    assert(typeof res.data.healthy === "boolean", "Should contain boolean healthy flag");
    assert(res.data.status !== undefined, "Should contain specific status code");
    assert(res.data.provider !== undefined, "Should identify active provider");
  });

  // Test 2: Unmatched Question Never Selects Arbitrary available_tables[0]
  await test("Arbitrary table selection removed — unmatched question returns limitation", async () => {
    const res = await axios.post(`${BASE_URL}/generate-sql`, {
      question: "Show all rainfall records from the weather station table",
      schema_context: {
        tables: {
          employees: [{ name: "employee_id", type: "INT" }, { name: "salary", type: "NUMERIC" }],
          departments: [{ name: "department_id", type: "INT" }, { name: "department_name", type: "VARCHAR" }]
        }
      }
    });
    // In our new generator, unmatched tables return generated_sql: null and an explanation of available tables
    const sql = res.data.generated_sql;
    assert(!sql, "Unmatched query must NOT generate SQL selecting arbitrary table available_tables[0]");
    const explanation = (res.data.explanation || "").toLowerCase();
    assert(
      explanation.includes("available tables") || explanation.includes("could not identify") || explanation.includes("schema"),
      `Should explain schema limitation or ask clarification, got: ${res.data.explanation}`
    );
  });

  // Test 3: AST Column Validation Rejects Unknown Column
  await test("Schema validator detects and rejects non-existent columns", async () => {
    const mockSchema = {
      project_id: "p1",
      table_row_counts: { employees: 10 },
      relationships: [],
      tables: {
        employees: [
          { name: "employee_id", type: "INTEGER" },
          { name: "salary", type: "NUMERIC" },
          { name: "department_id", type: "INTEGER" }
        ]
      }
    };

    const validQuery = "SELECT employee_id, salary FROM employees WHERE salary > 50000";
    const validCheck = SchemaService.verifySQLAgainstSchema(validQuery, mockSchema as any);
    assert(validCheck.valid, "Valid query should pass validation");

    const invalidColQuery = "SELECT employee_id, non_existent_column FROM employees WHERE invalid_col_filter > 10";
    const invalidCheck = SchemaService.verifySQLAgainstSchema(invalidColQuery, mockSchema as any);
    assert(!invalidCheck.valid, "Query with non-existent column must fail validation");
    assert(invalidCheck.missingColumns.length > 0, "Should identify missing columns");
  });

  // Test 4: AST Table Validation Rejects Unknown Table
  await test("Schema validator detects and rejects non-existent tables", async () => {
    const mockSchema = {
      project_id: "p1",
      table_row_counts: { employees: 10 },
      relationships: [],
      tables: {
        employees: [
          { name: "employee_id", type: "INTEGER" },
          { name: "salary", type: "NUMERIC" }
        ]
      }
    };

    const invalidTableQuery = "SELECT * FROM secret_financial_records JOIN employees ON id = id";
    const check = SchemaService.verifySQLAgainstSchema(invalidTableQuery, mockSchema as any);
    assert(!check.valid, "Query with unauthorized table must fail validation");
    assert(check.missingTables.includes("secret_financial_records"), "Should flag secret_financial_records");
  });

  // Test 5: AST Validator Handles CTEs Without Flagging Them As Missing Tables
  await test("Schema validator permits Common Table Expressions (WITH cte AS)", async () => {
    const mockSchema = {
      project_id: "p1",
      table_row_counts: { employees: 10, departments: 5 },
      relationships: [],
      tables: {
        employees: [{ name: "employee_id", type: "INTEGER" }, { name: "salary", type: "NUMERIC" }, { name: "department_id", type: "INTEGER" }],
        departments: [{ name: "department_id", type: "INTEGER" }, { name: "department_name", type: "VARCHAR" }]
      }
    };

    const cteQuery = `
      WITH dept_avg AS (
        SELECT department_id, AVG(salary) AS avg_sal FROM employees GROUP BY department_id
      )
      SELECT e.employee_id, e.salary, d.avg_sal
      FROM employees e
      JOIN dept_avg d ON e.department_id = d.department_id
    `;
    const check = SchemaService.verifySQLAgainstSchema(cteQuery, mockSchema as any);
    assert(check.valid, "CTE table should be recognized as a valid virtual table");
    assert(!check.missingTables.includes("dept_avg"), "dept_avg should not be flagged as missing");
  });

  // Test 6: Python AST Endpoint (/validate-sql)
  await test("AI Service /validate-sql AST endpoint validates dialect and columns", async () => {
    const res = await axios.post(`${BASE_URL}/validate-sql`, {
      sql: "SELECT first_name, salary FROM employees WHERE salary > 100000",
      schema_context: {
        tables: {
          employees: [{ name: "first_name" }, { name: "salary" }]
        }
      }
    });
    assert(res.data.is_valid === true, "Query should be valid");
    assert(res.data.query_type === "SELECT", "Query type should be SELECT");

    // Test rejection of non-existent column
    const badColRes = await axios.post(`${BASE_URL}/validate-sql`, {
      sql: "SELECT fake_column FROM employees",
      schema_context: {
        tables: {
          employees: [{ name: "first_name" }, { name: "salary" }]
        }
      }
    });
    assert(badColRes.data.is_valid === false, "Bad column should be invalid");
  });

  // Test 7: Strict Project & User Isolation on Document Retrieval
  await test("Document retrieval strictly isolates across users and projects", async () => {
    const projA = "proj_iso_A";
    const projB = "proj_iso_B";
    const userA = "user_iso_A";
    const userB = "user_iso_B";

    // Index chunk for User A in Project A
    await axios.post(`${BASE_URL}/rag/index`, {
      project_id: projA,
      user_id: userA,
      file_id: "secret_file_A",
      content: "Confidential Project A Strategy: Launch Quantum Core in Q4.",
      metadata: { source: "strategy.pdf", page_number: 1 }
    });

    // User B searching Project B should NOT find User A's chunk
    const searchB = await axios.post(`${BASE_URL}/rag/query`, {
      project_id: projB,
      user_id: userB,
      query: "Quantum Core Strategy"
    });
    assert(searchB.data.results.length === 0, "User B in Project B must not see Project A chunks");

    // User B searching Project A should NOT find User A's chunk (user isolation)
    const searchA_by_B = await axios.post(`${BASE_URL}/rag/query`, {
      project_id: projA,
      user_id: userB,
      query: "Quantum Core Strategy"
    });
    assert(searchA_by_B.data.results.length === 0, "User B must not see User A chunks in Project A");

    // User A searching Project A DOES find chunk
    const searchA_by_A = await axios.post(`${BASE_URL}/rag/query`, {
      project_id: projA,
      user_id: userA,
      query: "Quantum Core Strategy"
    });
    assert(searchA_by_A.data.results.length > 0, "User A should retrieve their own chunk");
    assert(searchA_by_A.data.results[0].content.includes("Quantum Core"), "Correct content retrieved");
  });

  // Test 8: Database Mode Indication
  await test("DatabaseManager exposes active database mode", async () => {
    const mode = DatabaseManager.getDatabaseMode();
    assert(["postgres", "demo", "offline"].includes(mode), `Mode should be valid: got ${mode}`);
  });

  console.log("\n===============================================================");
  console.log(`🎯 TARGETED REPAIR SUMMARY: ${passedTests} / ${totalTests} PASSED`);
  console.log("===============================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Test execution fatal error:", e);
  process.exit(1);
});
