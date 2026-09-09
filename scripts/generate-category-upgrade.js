#!/usr/bin/env node
/**
 * Builds the runtime dataset for the "Ангилал ахиулах" (category_upgrade) exam
 * from the two source-of-truth files:
 *
 *   data-source/category-upgrade/questions.source.json  — extracted from the
 *       saved exam pages by scripts/import-category-upgrade.js
 *   data-source/category-upgrade/answer-research.json   — the researched answer
 *       key, each entry carrying its rule reference and confidence
 *
 * Output:
 *   data/category-upgrade/questions.json — the runtime bank the server serves
 *   data/category-upgrade/answers.json   — { "<test>": { "<question>": answer } }
 *
 * The runtime files live outside public/ on purpose: this exam is served only
 * through the authenticated API, so the questions and answers are not
 * downloadable without an entitled student session.
 *
 * Usage: node scripts/generate-category-upgrade.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "data-source", "category-upgrade");
const QUESTIONS_SOURCE = path.join(SOURCE_DIR, "questions.source.json");
const ANSWER_RESEARCH = path.join(SOURCE_DIR, "answer-research.json");
const OUT_DIR = path.join(ROOT, "data", "category-upgrade");

const EXAM_TYPE = "category_upgrade";
const DISPLAY_NAME = "Ангилал ахиулах";
const TOTAL_TESTS = 20;
const QUESTIONS_PER_TEST = 10;

const errors = [];

function main() {
  for (const file of [QUESTIONS_SOURCE, ANSWER_RESEARCH]) {
    if (!fs.existsSync(file)) {
      console.error(`Missing source file: ${path.relative(ROOT, file)}`);
      process.exit(2);
    }
  }

  const questions = JSON.parse(fs.readFileSync(QUESTIONS_SOURCE, "utf8"));
  const research = JSON.parse(fs.readFileSync(ANSWER_RESEARCH, "utf8"));

  const key = new Map();
  for (const r of research) {
    const k = `${r.test}-${r.question}`;
    if (key.has(k)) errors.push(`Answer key has a duplicate entry for test ${r.test} q${r.question}`);
    key.set(k, r);
  }

  const tests = {};
  const answers = {};
  const confidence = { HIGH: 0, MEDIUM: 0, LOW: 0, NEEDS_REVIEW: 0 };

  for (const q of questions) {
    const label = `Test ${q.testNumber} q${q.questionNumber}`;
    const entry = key.get(`${q.testNumber}-${q.questionNumber}`);
    if (!entry) {
      errors.push(`${label}: no answer in answer-research.json`);
      continue;
    }
    const answer = entry.correctAnswer;
    if (!Number.isInteger(answer) || answer < 1 || answer > q.options.length) {
      errors.push(`${label}: answer ${answer} is outside 1..${q.options.length}`);
      continue;
    }
    // Guards against a key that drifted away from the questions it describes.
    if (entry.id !== q.id) errors.push(`${label}: answer key id ${entry.id} != question id ${q.id}`);
    if (entry.answerText !== q.options[answer - 1]) {
      errors.push(`${label}: answer text in the key does not match option ${answer}`);
    }
    if (!entry.source || !entry.rationale) errors.push(`${label}: answer has no evidence recorded`);
    if (confidence[entry.confidence] === undefined) {
      errors.push(`${label}: unknown confidence "${entry.confidence}"`);
    } else {
      confidence[entry.confidence] += 1;
    }

    if (q.imagePath) {
      const onDisk = path.join(ROOT, q.imagePath.replace(/^\/public\//, "public/"));
      if (!fs.existsSync(onDisk)) errors.push(`${label}: image missing at ${q.imagePath}`);
    }

    const list = (tests[q.testNumber] = tests[q.testNumber] || []);
    list.push({
      id: q.id,
      testNumber: q.testNumber,
      questionNumber: q.questionNumber,
      question: q.question,
      options: q.options,
      imagePath: q.imagePath,
      correctAnswer: answer
    });
    answers[q.testNumber] = answers[q.testNumber] || {};
    answers[q.testNumber][q.questionNumber] = answer;
  }

  for (let t = 1; t <= TOTAL_TESTS; t += 1) {
    const list = tests[t] || [];
    if (list.length !== QUESTIONS_PER_TEST) {
      errors.push(`Test ${t}: ${list.length} questions, expected ${QUESTIONS_PER_TEST}`);
    }
    list.sort((a, b) => a.questionNumber - b.questionNumber);
  }

  if (errors.length) {
    console.error("Generation failed:");
    for (const e of errors) console.error("  -", e);
    process.exit(2);
  }

  // Content hash: the client uses it to bust any cached copy when the bank changes.
  const version = crypto
    .createHash("sha1")
    .update(JSON.stringify(tests))
    .digest("hex")
    .slice(0, 12);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "questions.json"),
    JSON.stringify(
      {
        examType: EXAM_TYPE,
        displayName: DISPLAY_NAME,
        version,
        totalTests: TOTAL_TESTS,
        questionsPerTest: QUESTIONS_PER_TEST,
        generatedAt: new Date().toISOString(),
        tests
      },
      null,
      1
    ) + "\n"
  );
  fs.writeFileSync(path.join(OUT_DIR, "answers.json"), JSON.stringify(answers, null, 1) + "\n");

  const total = Object.values(tests).reduce((s, l) => s + l.length, 0);
  console.log(`Generated ${total} questions across ${TOTAL_TESTS} "${DISPLAY_NAME}" tests.`);
  console.log(`  version:        ${version}`);
  console.log(`  with images:    ${questions.filter((q) => q.imagePath).length}`);
  console.log(
    `  confidence:     HIGH ${confidence.HIGH} · MEDIUM ${confidence.MEDIUM} · ` +
      `LOW ${confidence.LOW} · NEEDS_REVIEW ${confidence.NEEDS_REVIEW}`
  );
  console.log(`  ${path.relative(ROOT, path.join(OUT_DIR, "questions.json"))}`);
  console.log(`  ${path.relative(ROOT, path.join(OUT_DIR, "answers.json"))}`);
}

main();
