#!/usr/bin/env node
/**
 * Integrity check for the "Ангилал ахиулах" (category_upgrade) exam:
 *   - 20 tests, 10 questions each, 200 questions in total
 *   - every question has text, at least two options, and no blank option
 *   - every correct answer is an existing option index, matched to its text
 *   - every answer carries a rule reference, a rationale and a confidence
 *   - every referenced image resolves to a real file
 *   - no duplicate question ids, no test-number drift against the source
 *
 * Usage: node scripts/validate-category-upgrade.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "data-source", "category-upgrade", "questions.source.json");
const RESEARCH = path.join(ROOT, "data-source", "category-upgrade", "answer-research.json");
const RUNTIME = path.join(ROOT, "data", "category-upgrade", "questions.json");
const ANSWERS = path.join(ROOT, "data", "category-upgrade", "answers.json");

const TOTAL_TESTS = 20;
const QUESTIONS_PER_TEST = 10;
const TOTAL_QUESTIONS = TOTAL_TESTS * QUESTIONS_PER_TEST;
const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "NEEDS_REVIEW"];

const errors = [];
const check = (ok, message) => { if (!ok) errors.push(message); };

function main() {
  for (const file of [SOURCE, RESEARCH, RUNTIME, ANSWERS]) {
    check(fs.existsSync(file), `${path.relative(ROOT, file)} is missing`);
  }
  if (errors.length) return finish();

  const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const research = JSON.parse(fs.readFileSync(RESEARCH, "utf8"));
  const runtime = JSON.parse(fs.readFileSync(RUNTIME, "utf8"));
  const answers = JSON.parse(fs.readFileSync(ANSWERS, "utf8"));

  check(source.length === TOTAL_QUESTIONS,
    `questions.source.json has ${source.length} questions, expected ${TOTAL_QUESTIONS}`);
  check(research.length === TOTAL_QUESTIONS,
    `answer-research.json has ${research.length} answers, expected ${TOTAL_QUESTIONS}`);
  check(runtime.totalTests === TOTAL_TESTS, `runtime totalTests is ${runtime.totalTests}`);
  check(runtime.questionsPerTest === QUESTIONS_PER_TEST,
    `runtime questionsPerTest is ${runtime.questionsPerTest}`);
  check(typeof runtime.version === "string" && runtime.version.length > 0,
    "runtime dataset has no version stamp");

  const confidence = { HIGH: 0, MEDIUM: 0, LOW: 0, NEEDS_REVIEW: 0 };
  const review = [];
  const ids = new Set();
  const sourceByKey = new Map(source.map((q) => [`${q.testNumber}-${q.questionNumber}`, q]));
  let imageCount = 0;
  let runtimeCount = 0;

  for (let t = 1; t <= TOTAL_TESTS; t += 1) {
    const list = runtime.tests[String(t)];
    if (!Array.isArray(list)) {
      errors.push(`Test ${t}: missing from the runtime dataset`);
      continue;
    }
    check(list.length === QUESTIONS_PER_TEST,
      `Test ${t}: ${list.length} questions, expected ${QUESTIONS_PER_TEST}`);

    list.forEach((q, i) => {
      runtimeCount += 1;
      const label = `Test ${t} q${q.questionNumber}`;

      check(q.testNumber === t, `${label}: testNumber ${q.testNumber} does not match its test`);
      check(q.questionNumber === i + 1, `${label}: out of order (position ${i + 1})`);
      check(!ids.has(q.id), `${label}: duplicate question id ${q.id}`);
      ids.add(q.id);

      check(typeof q.question === "string" && q.question.trim().length > 0,
        `${label}: empty question text`);
      check(Array.isArray(q.options) && q.options.length >= 2,
        `${label}: fewer than two answer options`);
      check((q.options || []).every((o) => typeof o === "string" && o.trim().length > 0),
        `${label}: blank answer option`);

      const a = q.correctAnswer;
      check(Number.isInteger(a) && a >= 1 && a <= (q.options || []).length,
        `${label}: correctAnswer ${a} is outside 1..${(q.options || []).length}`);

      const mapped = answers[String(t)] && answers[String(t)][String(q.questionNumber)];
      check(mapped === a, `${label}: answers.json says ${mapped}, questions.json says ${a}`);

      const src = sourceByKey.get(`${t}-${q.questionNumber}`);
      if (!src) {
        errors.push(`${label}: no matching entry in questions.source.json`);
      } else {
        check(src.id === q.id, `${label}: id drifted from the source (${src.id} vs ${q.id})`);
        check(src.question === q.question, `${label}: question text drifted from the source`);
        check(JSON.stringify(src.options) === JSON.stringify(q.options),
          `${label}: answer options drifted from the source`);
        check(src.imagePath === q.imagePath, `${label}: image path drifted from the source`);
      }

      if (q.imagePath) {
        imageCount += 1;
        const onDisk = path.join(ROOT, q.imagePath.replace(/^\/public\//, "public/"));
        check(fs.existsSync(onDisk), `${label}: broken image path ${q.imagePath}`);
      }
    });
  }

  for (const r of research) {
    const label = `Test ${r.test} q${r.question}`;
    const src = sourceByKey.get(`${r.test}-${r.question}`);
    if (!src) {
      errors.push(`${label}: answer key refers to a question that does not exist`);
      continue;
    }
    check(r.id === src.id, `${label}: answer key id does not match the question`);
    check(Number.isInteger(r.correctAnswer) && r.correctAnswer >= 1 &&
      r.correctAnswer <= src.options.length,
      `${label}: answer ${r.correctAnswer} is outside 1..${src.options.length}`);
    check(r.answerText === src.options[r.correctAnswer - 1],
      `${label}: recorded answer text does not match the option it points at`);
    check(typeof r.source === "string" && r.source.length > 0, `${label}: no source recorded`);
    check(typeof r.clause === "string" && r.clause.length > 0, `${label}: no clause recorded`);
    check(typeof r.rationale === "string" && r.rationale.length > 20,
      `${label}: rationale is missing or too short to be evidence`);
    if (CONFIDENCE_LEVELS.indexOf(r.confidence) === -1) {
      errors.push(`${label}: unknown confidence "${r.confidence}"`);
    } else {
      confidence[r.confidence] += 1;
      if (r.confidence !== "HIGH") review.push(`Тест ${r.test} асуулт ${r.question} (${r.confidence})`);
    }
  }

  finish({ runtimeCount, imageCount, confidence, review });
}

function finish(stats) {
  console.log("=== АНГИЛАЛ АХИУЛАХ VALIDATION REPORT ===");
  if (stats) {
    console.log(`Tests:            ${TOTAL_TESTS} / ${TOTAL_TESTS}`);
    console.log(`Questions:        ${stats.runtimeCount} / ${TOTAL_QUESTIONS}`);
    console.log(`Questions w/ img: ${stats.imageCount}`);
    console.log(
      `Confidence:       HIGH ${stats.confidence.HIGH} · MEDIUM ${stats.confidence.MEDIUM} · ` +
        `LOW ${stats.confidence.LOW} · NEEDS_REVIEW ${stats.confidence.NEEDS_REVIEW}`
    );
  }
  if (errors.length) {
    console.log(`\nFAILED — ${errors.length} problem(s):`);
    for (const e of errors) console.log("  ✗ " + e);
    process.exit(2);
  }
  console.log("Duplicate ids:    0");
  console.log("Broken paths:     0");
  if (stats && stats.review.length) {
    console.log(`\nБагшийн хяналт шаардлагатай (${stats.review.length}):`);
    for (const r of stats.review) console.log("  • " + r);
  }
  console.log("\nAll checks passed ✓");
}

main();
