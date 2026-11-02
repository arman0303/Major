/**
 * General Conversation Flow Tests
 * Tests that the assistant correctly handles general knowledge, programming help,
 * and conversational questions — NOT sql_analytics.
 *
 * Run: npx tsx tests/general_conversation_tests.ts
 */

import axios from "axios";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";
const BASE_URL = `${AI_SERVICE_URL}/api/ai`;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: message });
    console.log(`  ✗ ${name}: ${message}`);
  }
}

const NON_SQL_INTENTS = [
  "general_conversation",
  "general_knowledge",
  "programming_help",
  "greeting",
  "ambiguous",
  "document_qa",
];

async function testIntentRouting(): Promise<void> {
  console.log("\n📋 Intent Routing Tests\n");

  await runTest("Explain AI → NOT sql_analytics", async () => {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: "Explain artificial intelligence in simple terms",
      conversation_history: [],
      schema_context: { tables: {} },
      has_uploaded_docs: false,
    });
    const { intent, answer } = res.data;
    assert(
      NON_SQL_INTENTS.includes(intent),
      `Expected non-SQL intent, got: ${intent}`
    );
    assert(answer && answer.length > 30, "Answer should be non-empty");
  });

  await runTest("Machine learning vs deep learning → NOT sql_analytics", async () => {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: "What is the difference between machine learning and deep learning?",
      conversation_history: [],
      schema_context: { tables: {} },
      has_uploaded_docs: false,
    });
    assert(
      res.data.intent !== "sql_analytics",
      `ML question should not be sql_analytics, got: ${res.data.intent}`
    );
    assert(res.data.answer && res.data.answer.length > 30, "Answer should be non-empty");
  });

  await runTest("Java program question → programming_help or general", async () => {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: "Write a Java program to reverse a string",
      conversation_history: [],
      schema_context: { tables: {} },
      has_uploaded_docs: false,
    });
    const { intent, answer } = res.data;
    assert(
      ["programming_help", "general_conversation", "general_knowledge"].includes(intent),
      `Expected programming intent, got: ${intent}`
    );
    assert(answer && answer.length > 30, "Answer should be non-empty");
  });

  await runTest("Interview prep → NOT sql_analytics", async () => {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: "Help me prepare for a software engineering interview",
      conversation_history: [],
      schema_context: { tables: {} },
      has_uploaded_docs: false,
    });
    assert(
      res.data.intent !== "sql_analytics",
      `Interview prep should not be sql_analytics, got: ${res.data.intent}`
    );
    assert(res.data.answer && res.data.answer.length > 30, "Answer should be meaningful");
  });

  await runTest("REST API explanation → programming/general intent", async () => {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: "Explain REST APIs with an example",
      conversation_history: [],
      schema_context: { tables: {} },
      has_uploaded_docs: false,
    });
    assert(
      ["programming_help", "general_conversation", "general_knowledge"].includes(res.data.intent),
      `Expected programming/general intent, got: ${res.data.intent}`
    );
    assert(res.data.answer && res.data.answer.length > 30, "Answer should be non-empty");
  });

  await runTest("Heap data structure → NOT sql_analytics", async () => {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: "What is a heap data structure?",
      conversation_history: [],
      schema_context: { tables: {} },
      has_uploaded_docs: false,
    });
    assert(
      res.data.intent !== "sql_analytics",
      `Heap DS question should not be sql_analytics, got: ${res.data.intent}`
    );
    assert(res.data.answer && res.data.answer.length > 20, "Answer should be meaningful");
  });

  await runTest("Follow-up 'explain it more simply' → NOT sql_analytics", async () => {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: "explain it more simply",
      conversation_history: [
        { role: "user", content: "Explain artificial intelligence in simple terms" },
        {
          role: "assistant",
          content:
            "AI refers to computer systems that can perform tasks requiring human intelligence...",
        },
      ],
      schema_context: { tables: {} },
      has_uploaded_docs: false,
    });
    assert(
      res.data.intent !== "sql_analytics",
      `Follow-up should not route to sql_analytics, got: ${res.data.intent}`
    );
    assert(res.data.answer && res.data.answer.length > 10, "Follow-up answer should not be empty");
  });

  await runTest("Hello greeting → greeting intent", async () => {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: "Hello",
      conversation_history: [],
      schema_context: { tables: {} },
      has_uploaded_docs: false,
    });
    assert(res.data.intent === "greeting", `Expected greeting, got: ${res.data.intent}`);
    assert(res.data.answer && res.data.answer.length > 10, "Greeting answer should be non-empty");
  });

  await runTest("SQL query still routes to sql_analytics", async () => {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: "Show me the top 5 employees by salary",
      conversation_history: [],
      schema_context: { tables: { employees: { columns: ["id", "name", "salary"] } } },
      has_uploaded_docs: false,
    });
    assert(
      res.data.intent === "sql_analytics",
      `SQL query should be sql_analytics, got: ${res.data.intent}`
    );
  });

  await runTest("Provider status endpoint reachable", async () => {
    try {
      const res = await axios.get(`${BASE_URL}/provider-status`);
      assert(res.status === 200, "Provider status should return 200");
      assert(
        "status" in res.data || "has_active_api_key" in res.data,
        "Should have status or has_active_api_key field"
      );
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        console.log("    (provider-status endpoint not yet deployed — skipping)");
        return;
      }
      throw err;
    }
  });
}

async function main(): Promise<void> {
  console.log("🧪 General Conversation Tests for DataPilot\n");
  console.log(`AI Service: ${AI_SERVICE_URL}`);

  try {
    await axios.get(`${AI_SERVICE_URL}/health`);
    console.log("✓ AI Service is running");
  } catch {
    console.error("✗ AI Service is not running at", AI_SERVICE_URL);
    process.exit(1);
  }

  await testIntentRouting();

  console.log("\n" + "=".repeat(50));
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Results: ${passed}/${results.length} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log("\n✅ All general conversation tests passed!");
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
