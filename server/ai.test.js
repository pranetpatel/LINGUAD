import { test } from "node:test";
import assert from "node:assert";
import { pickProvider, normalizeOpenAI, sanitizeMessages } from "./ai.js";

test("provider selection: preference honored only when its key exists, anthropic wins ties", () => {
  assert.equal(pickProvider({ anthropicKey: "a", openaiKey: "o", pref: "openai" }), "openai");
  assert.equal(pickProvider({ anthropicKey: "a", openaiKey: "o", pref: undefined }), "anthropic");
  assert.equal(pickProvider({ anthropicKey: "", openaiKey: "o", pref: "anthropic" }), "openai");
  assert.equal(pickProvider({ anthropicKey: "", openaiKey: "", pref: "openai" }), null);
});

test("openai responses normalize to anthropic content blocks", () => {
  const n = normalizeOpenAI({ model: "gpt-4o-mini", choices: [{ message: { role: "assistant", content: "¡Hola!" } }] });
  assert.deepEqual(n.content, [{ type: "text", text: "¡Hola!" }]);
  assert.equal(n.provider, "openai");
});

test("message sanitization caps depth and size and coerces roles", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? "assistant" : "system", content: "x".repeat(9000) }));
  const out = sanitizeMessages(many);
  assert.equal(out.length, 60);
  assert.ok(out.every(m => m.content.length === 8000));
  assert.ok(out.every(m => ["user", "assistant"].includes(m.role)));
});
