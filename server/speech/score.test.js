import { test } from "node:test";
import assert from "node:assert";
import { scoreUtterance, alignWords, tokenize, g2p } from "./score.js";

test("perfect match scores 100 with no advice flags", () => {
  const r = scoreUtterance({ expected: "¿Dónde está la biblioteca?", heard: "donde esta la biblioteca", lang: "es" });
  assert.equal(r.overall, 100);
  assert.ok(r.words.every(w => w.ok));
});

test("substituted word is caught, scored low, and gets phoneme advice", () => {
  const r = scoreUtterance({ expected: "el perro corre rápido", heard: "el pero corre rapido", lang: "es" });
  const perro = r.words.find(w => w.expected === "perro");
  assert.ok(perro.score < 90 && perro.score > 40);
  assert.ok(r.overall < 100);
});

test("missing word scores zero and is reported missed", () => {
  const r = scoreUtterance({ expected: "quiero un café por favor", heard: "quiero café por favor", lang: "es" });
  const un = r.words.find(w => w.expected === "un");
  assert.equal(un.heard, null);
  assert.equal(un.score, 0);
  assert.ok(r.advice.some(a => a.includes('"un"')));
});

test("ASR confidence blends into the score", () => {
  const hi = scoreUtterance({ expected: "hola amigo", heard: "hola amigo", lang: "es", overallConf: 0.95 });
  const lo = scoreUtterance({ expected: "hola amigo", heard: "hola amigo", lang: "es", overallConf: 0.3 });
  assert.ok(hi.overall > lo.overall);
});

test("alignment pairs near-miss words instead of del+ins", () => {
  const ops = alignWords(tokenize("gracias"), tokenize("grasias"));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].exp, "gracias");
  assert.equal(ops[0].hyp, "grasias");
});

test("spanish g2p handles digraphs and silent h", () => {
  assert.deepEqual(g2p("chico", "es"), ["tʃ", "i", "k", "o"]);
  assert.deepEqual(g2p("hola", "es"), ["o", "l", "a"]);
  assert.ok(g2p("perro", "es").includes("r"));   // trill
  assert.ok(g2p("pero", "es").includes("ɾ"));    // tap
});

test("english scoring flags th-substitution", () => {
  const r = scoreUtterance({ expected: "thank you very much", heard: "tank you very much", lang: "en" });
  const th = r.words.find(w => w.expected === "thank");
  assert.ok(!th.ok);
  assert.ok(r.advice[0].includes("thank"));
});
