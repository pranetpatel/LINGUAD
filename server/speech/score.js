/* ── The speech-scoring pipeline core (blueprint §10) ─────────────────────
   Stages: normalize → word alignment (similarity-weighted Levenshtein) →
   grapheme-to-phoneme (rule-based ES, heuristic EN) → per-word scores
   blending edit similarity with ASR word confidence → phoneme-level diffs
   → targeted advice. Pure functions, fully unit-tested, no I/O. */

const strip = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const tokenize = (t, keepAccents = false) =>
  (keepAccents ? t : strip(t))
    .toLowerCase()
    .replace(/[^a-zñü'\u00e0-\u00ff\s-]/gi, " ")
    .split(/[\s-]+/)
    .filter(Boolean);

/* char-level edit distance + similarity */
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
export const charSim = (a, b) => (!a && !b ? 1 : 1 - editDistance(strip(a), strip(b)) / Math.max(a.length, b.length, 1));

/* word alignment: DP where substitution cost = 1 - charSim (so near-misses align) */
export function alignWords(expected, heard) {
  const m = expected.length, n = heard.length;
  const cost = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  const back = Array.from({ length: m + 1 }, () => Array(n + 1).fill(null));
  for (let i = 1; i <= m; i++) { cost[i][0] = i; back[i][0] = "del"; }
  for (let j = 1; j <= n; j++) { cost[0][j] = j; back[0][j] = "ins"; }
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const sub = cost[i - 1][j - 1] + (1 - charSim(expected[i - 1], heard[j - 1]));
      const del = cost[i - 1][j] + 1;
      const ins = cost[i][j - 1] + 1;
      const best = Math.min(sub, del, ins);
      cost[i][j] = best;
      back[i][j] = best === sub ? "sub" : best === del ? "del" : "ins";
    }
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    const op = i === 0 ? "ins" : j === 0 ? "del" : back[i][j];
    if (op === "sub") { ops.unshift({ exp: expected[--i], hyp: heard[--j] }); }
    else if (op === "del") { ops.unshift({ exp: expected[--i], hyp: null }); }
    else { ops.unshift({ exp: null, hyp: heard[--j] }); }
  }
  return ops;
}

/* ── grapheme-to-phoneme ──
   Spanish: near-deterministic Latin-American rules. English: heuristic
   letter-to-sound (approximate — the acoustic model refines this in prod). */
export function g2p(word, lang) {
  const w = word.toLowerCase();
  const out = [];
  if (lang === "es") {
    for (let i = 0; i < w.length; i++) {
      const c = w[i], nx = w[i + 1] || "";
      if (c === "c" && nx === "h") { out.push("tʃ"); i++; }
      else if (c === "l" && nx === "l") { out.push("ʝ"); i++; }
      else if (c === "r" && nx === "r") { out.push("r"); i++; }
      else if (c === "q" && nx === "u") { out.push("k"); i++; }
      else if (c === "g" && nx === "u" && "ei".includes(w[i + 2] || "")) { out.push("g"); i++; }
      else if (c === "g" && "ei".includes(nx)) out.push("x");
      else if (c === "c" && "ei".includes(nx)) out.push("s");
      else if (c === "c") out.push("k");
      else if (c === "z") out.push("s");
      else if (c === "v" || c === "b") out.push("b");
      else if (c === "ñ") out.push("ɲ");
      else if (c === "j") out.push("x");
      else if (c === "h") continue;
      else if (c === "y") out.push(i === w.length - 1 ? "i" : "ʝ");
      else if (c === "r") out.push(i === 0 ? "r" : "ɾ");
      else if ("áéíóúü".includes(c)) out.push(strip(c));
      else if ("aeiou".includes(c)) out.push(c);
      else if ("dfglmnpstkxw".includes(c)) out.push(c === "x" ? "ks" : c);
      else out.push(c);
    }
    return out;
  }
  // English heuristics
  const digraphs = { th: "θ", sh: "ʃ", ch: "tʃ", ph: "f", wh: "w", ck: "k", ng: "ŋ", qu: "kw", oo: "u", ee: "i", ea: "i", ai: "eɪ", ay: "eɪ", ou: "aʊ", ow: "aʊ", oa: "oʊ", igh: "aɪ" };
  for (let i = 0; i < w.length; i++) {
    const tri = w.slice(i, i + 3), di = w.slice(i, i + 2), c = w[i];
    if (digraphs[tri]) { out.push(digraphs[tri]); i += 2; continue; }
    if (digraphs[di]) { out.push(digraphs[di]); i += 1; continue; }
    if (c === "e" && i === w.length - 1 && w.length > 2) continue; // magic e
    const map = { a: "æ", e: "ɛ", i: "ɪ", o: "ɑ", u: "ʌ", c: "k", j: "dʒ", y: i === 0 ? "j" : "i", x: "ks" };
    out.push(map[c] || c);
  }
  return out;
}

const PHONEME_TIPS = {
  es: { r: "the rolled 'rr' — tongue-tip trill", "ɾ": "the single tap 'r'", x: "the 'j/g' sound from the back of the throat", "ɲ": "'ñ' — like the 'ny' in canyon", "ʝ": "'ll/y' — a soft 'y' sound", b: "'b/v' — both are a soft 'b' in Spanish" },
  en: { "θ": "'th' — tongue between the teeth", "ʃ": "'sh'", "tʃ": "'ch'", "æ": "the short 'a' as in 'cat'", "ɪ": "the short 'i' as in 'sit'", "ŋ": "the '-ng' ending" },
};

function phonemeDiff(exp, hyp, lang) {
  const pe = g2p(exp, lang), ph = g2p(hyp || "", lang);
  const bad = [];
  const L = Math.max(pe.length, ph.length);
  for (let i = 0; i < L; i++) if (pe[i] !== ph[i] && pe[i]) bad.push(pe[i]);
  return [...new Set(bad)].slice(0, 3);
}

function phonemeSim(exp, hyp, lang) {
  const pe = g2p(exp, lang), ph = g2p(hyp || "", lang);
  if (!pe.length) return 1;
  // sequence edit distance over phoneme arrays
  const m = pe.length, n = ph.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (pe[i - 1] === ph[j - 1] ? 0 : 1));
  let sim = 1 - d[m][n] / Math.max(m, n);
  if (pe[0] !== ph[0]) sim *= 0.85; // onset errors are perceptually severe
  return sim;
}

/** Main entry. expected/heard = strings; wordConfs = optional map heardWord→0..1
    from the acoustic ASR. Returns {overall, words[], advice[]}. */
export function scoreUtterance({ expected, heard, lang = "es", wordConfs = null, overallConf = null }) {
  const exp = tokenize(expected);
  const hyp = tokenize(heard || "");
  if (!exp.length) return { overall: 0, words: [], advice: ["Nothing to score."] };
  const ops = alignWords(exp, hyp);
  const words = [];
  for (const op of ops) {
    if (!op.exp) continue; // extra inserted word — ignored for scoring
    let sim = op.hyp ? 0.45 * charSim(op.exp, op.hyp) + 0.55 * phonemeSim(op.exp, op.hyp, lang) : 0;
    const conf = op.hyp && wordConfs ? wordConfs[strip(op.hyp.toLowerCase())] : (op.hyp ? overallConf : null);
    let score = typeof conf === "number" ? 0.6 * sim + 0.4 * conf : sim;
    score = Math.round(Math.max(0, Math.min(1, score)) * 100);
    const entry = { expected: op.exp, heard: op.hyp, score, ok: score >= 75 };
    if (!entry.ok) entry.phonemes = phonemeDiff(op.exp, op.hyp, lang);
    words.push(entry);
  }
  const totalLen = words.reduce((t, w) => t + w.expected.length, 0) || 1;
  const overall = Math.round(words.reduce((t, w) => t + w.score * w.expected.length, 0) / totalLen);
  const worst = [...words].filter(w => !w.ok).sort((a, b) => a.score - b.score).slice(0, 2);
  const tips = PHONEME_TIPS[lang] || {};
  const advice = worst.map(w => {
    const hint = (w.phonemes || []).map(p => tips[p]).filter(Boolean)[0];
    return `"${w.expected}"${w.heard ? ` came out as "${w.heard}"` : " was missed"}${hint ? ` — focus on ${hint}` : ""}.`;
  });
  if (!advice.length) advice.push(overall >= 90 ? "Excellent — crisp and complete." : "Solid — one more pass and it's locked in.");
  return { overall, words, advice };
}
