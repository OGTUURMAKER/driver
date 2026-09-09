#!/usr/bin/env node
/**
 * Imports the "Ангилал ахиулах" (category_upgrade) question bank from the
 * saved Google Forms pages in the source folder.
 *
 * Each source page is a "Save page complete" copy of a Google Form. The
 * question payload lives in the inline `FB_PUBLIC_LOAD_DATA_` array; the
 * question images were saved next to it in a `<name>_files/` folder and the
 * page's <img> tags were rewritten to point at them.
 *
 * Question → image mapping is taken from the <img> order in the document and
 * then verified against the width/height the form data records for each
 * image, so a mis-ordered download fails the import instead of silently
 * shifting pictures onto the wrong questions.
 *
 * Outputs:
 *   data-source/category-upgrade/questions.source.json  — extracted questions
 *   public/assets/category-upgrade/test-NN/qNN.jpg      — question images
 *
 * The answer key is NOT part of this file. It lives in
 * data-source/category-upgrade/answer-research.json and is merged in by
 * scripts/generate-category-upgrade.js.
 *
 * Usage: node scripts/import-category-upgrade.js [sourceDir]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_SOURCE = path.join(
  process.env.HOME || require("os").homedir(),
  "Desktop",
  "Driver Test"
);
const SOURCE_DIR = process.argv[2] || process.env.CU_SOURCE_DIR || DEFAULT_SOURCE;
const OUT_FILE = path.join(ROOT, "data-source", "category-upgrade", "questions.source.json");
const ASSET_DIR = path.join(ROOT, "public", "assets", "category-upgrade");

const TOTAL_TESTS = 20;
const QUESTIONS_PER_TEST = 10;

const errors = [];

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Collapses runs of whitespace and strips the "3. " prefix the forms carry. */
function cleanText(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(value) {
  return cleanText(value).replace(/^\d+\s*[.)]\s*/, "").trim();
}

/** Natural size of a JPEG, read straight from its SOF marker. */
function jpegSize(file) {
  const buf = fs.readFileSync(file);
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function readFormData(html) {
  const match = html.match(/var FB_PUBLIC_LOAD_DATA_ = (\[[\s\S]*?\]);\s*<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

/** Local <img> sources in document order, ignoring the Google logo. */
function localImageSources(html) {
  const out = [];
  const re = /<img[^>]+src="(\.\/[^"]+_files\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!/\.svg$/i.test(m[1])) out.push(decodeURIComponent(m[1].slice(2)));
  }
  return out;
}

function importTest(testNumber) {
  const htmlFile = path.join(SOURCE_DIR, `Тест ${testNumber}.html`);
  if (!fs.existsSync(htmlFile)) {
    errors.push(`Test ${testNumber}: source file not found (${htmlFile})`);
    return [];
  }

  const html = fs.readFileSync(htmlFile, "utf8");
  const data = readFormData(html);
  if (!data) {
    errors.push(`Test ${testNumber}: FB_PUBLIC_LOAD_DATA_ not found`);
    return [];
  }

  const items = (data[1] && data[1][1]) || [];
  if (items.length !== QUESTIONS_PER_TEST) {
    errors.push(`Test ${testNumber}: ${items.length} questions, expected ${QUESTIONS_PER_TEST}`);
  }

  const imageSources = localImageSources(html);
  const outDir = path.join(ASSET_DIR, `test-${pad2(testNumber)}`);
  fs.mkdirSync(outDir, { recursive: true });

  const questions = [];
  let imageCursor = 0;

  items.forEach((item, i) => {
    const questionNumber = i + 1;
    const label = `Test ${testNumber} q${questionNumber}`;
    const title = cleanTitle(item[1]);
    if (!title) errors.push(`${label}: empty question text`);

    const optionGroup = item[4] && item[4][0];
    const options = optionGroup && optionGroup[1] ? optionGroup[1].map((o) => cleanText(o[0])) : [];
    if (options.length < 2) errors.push(`${label}: ${options.length} answer options`);
    if (options.some((o) => !o)) errors.push(`${label}: blank answer option`);

    let imagePath = null;
    if (item[9] && item[9][0]) {
      const declared = item[9][0][2] || [];
      const source = imageSources[imageCursor];
      imageCursor += 1;
      if (!source) {
        errors.push(`${label}: form declares an image but no local file was saved`);
      } else {
        const absolute = path.join(SOURCE_DIR, source);
        if (!fs.existsSync(absolute)) {
          errors.push(`${label}: image file missing on disk (${source})`);
        } else {
          const size = jpegSize(absolute);
          // Independent proof the document-order mapping landed on the right
          // picture: the form records each image's pixel size.
          if (!size || size.width !== declared[0] || size.height !== declared[1]) {
            errors.push(
              `${label}: image mapping mismatch — form says ${declared[0]}x${declared[1]}, ` +
                `${source} is ${size ? size.width + "x" + size.height : "unreadable"}`
            );
          } else {
            const name = `q${pad2(questionNumber)}.jpg`;
            fs.copyFileSync(absolute, path.join(outDir, name));
            imagePath = `/public/assets/category-upgrade/test-${pad2(testNumber)}/${name}`;
          }
        }
      }
    }

    questions.push({
      id: `cu-test-${pad2(testNumber)}-q${pad2(questionNumber)}`,
      testNumber,
      questionNumber,
      question: title,
      options,
      imagePath
    });
  });

  if (imageCursor !== imageSources.length) {
    errors.push(
      `Test ${testNumber}: page has ${imageSources.length} saved images but the form data ` +
        `declares ${imageCursor}`
    );
  }

  return questions;
}

function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source folder not found: ${SOURCE_DIR}`);
    process.exit(2);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.mkdirSync(ASSET_DIR, { recursive: true });

  let questions = [];
  for (let t = 1; t <= TOTAL_TESTS; t += 1) {
    questions = questions.concat(importTest(t));
  }

  if (errors.length) {
    console.error("Import failed:");
    for (const e of errors) console.error("  -", e);
    process.exit(2);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(questions, null, 1) + "\n");

  const withImages = questions.filter((q) => q.imagePath).length;
  console.log(`Imported ${questions.length} questions across ${TOTAL_TESTS} tests.`);
  console.log(`  images copied:  ${withImages}`);
  console.log(`  answer options: ${questions.reduce((s, q) => s + q.options.length, 0)}`);
  console.log(`  ${path.relative(ROOT, OUT_FILE)}`);
}

main();
