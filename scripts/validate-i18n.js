#!/usr/bin/env node
/**
 * Localization integrity check:
 *   - mn and zh dictionaries define exactly the same keys, none blank
 *     (practice.imageOnlyNote may be blank in Mongolian by design)
 *   - every data-i18n / data-i18n-attr key used in public/*.html exists
 *   - every t("…") / I18N.t("…") literal key used in public/*.js exists
 *   - placeholders ({name}) match between the two languages
 *   - data/category-upgrade/translations.zh.json lines up with the question
 *     bank: same ids, same option count, no answer data, no leftover Cyrillic words
 *   - public/data/questions.zh.json (40-chapter bank): known ids, 2–5 options,
 *     every answer key within the transcribed options, and identical to what
 *     data-source/regular-zh/ generates
 *
 * Usage: node scripts/validate-i18n.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const LANGS = ["mn", "zh"];
const MAY_BE_BLANK = { mn: ["practice.imageOnlyNote"], zh: [] };

const errors = [];
const check = (ok, message) => { if (!ok) errors.push(message); };

function loadDictionaries() {
  const dictionaries = {};
  const sandbox = { I18N: { register: (id, messages) => { dictionaries[id] = messages; } } };
  vm.createContext(sandbox);
  for (const lang of LANGS) {
    const file = path.join(PUBLIC, "locales", `${lang}.js`);
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
    check(dictionaries[lang], `locales/${lang}.js did not register a dictionary`);
  }
  return dictionaries;
}

function placeholders(text) {
  return (String(text).match(/\{\w+\}/g) || []).sort().join(",");
}

function usedKeys() {
  const keys = new Map(); // key → first file that uses it
  const note = (key, file) => { if (!keys.has(key)) keys.set(key, file); };
  for (const name of fs.readdirSync(PUBLIC)) {
    const file = path.join(PUBLIC, name);
    if (name.endsWith(".html")) {
      const html = fs.readFileSync(file, "utf8");
      if (!html.includes("/public/i18n.js")) continue; // legacy pages are not localized
      for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) note(m[1], name);
      for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
        m[1].split(";").forEach((pair) => {
          const key = (pair.split(":")[1] || "").trim();
          if (key) note(key, name);
        });
      }
    } else if (name.endsWith(".js") && name !== "i18n.js") {
      const js = fs.readFileSync(file, "utf8");
      for (const m of js.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) note(m[1], name);
      for (const m of js.matchAll(/"((?:teacher|common|practice|results|upgrade|home|mode|server|activity|entitlement)\.[a-zA-Z]+)"/g)) {
        note(m[1], name);
      }
    }
  }
  return keys;
}

function checkQuestionTranslations() {
  const bankFile = path.join(ROOT, "data", "category-upgrade", "questions.json");
  const zhFile = path.join(ROOT, "data", "category-upgrade", "translations.zh.json");
  if (!fs.existsSync(zhFile)) {
    errors.push("data/category-upgrade/translations.zh.json is missing");
    return { total: 0, translated: 0 };
  }
  const bank = JSON.parse(fs.readFileSync(bankFile, "utf8"));
  const doc = JSON.parse(fs.readFileSync(zhFile, "utf8"));
  const zh = doc.questions || {};
  const ids = new Set();
  let total = 0;
  let translated = 0;
  for (const list of Object.values(bank.tests)) {
    for (const q of list) {
      total += 1;
      ids.add(q.id);
      const entry = zh[q.id];
      if (!entry) continue;
      translated += 1;
      check(typeof entry.question === "string" && entry.question.trim(), `${q.id}: empty Chinese question`);
      check(Array.isArray(entry.options) && entry.options.length === q.options.length,
        `${q.id}: Chinese has ${entry.options && entry.options.length} options, Mongolian has ${q.options.length}`);
      (entry.options || []).forEach((o, i) => check(String(o).trim(), `${q.id}: Chinese option ${i + 1} is blank`));
      check(!("correctAnswer" in entry) && !("answer" in entry), `${q.id}: translation must not carry answers`);
      const text = entry.question + " " + (entry.options || []).join(" ");
      check(!/[А-Яа-яЁёӨөҮү]{3,}/.test(text), `${q.id}: untranslated Mongolian left in the Chinese text`);
    }
  }
  for (const id of Object.keys(zh)) check(ids.has(id), `translations.zh.json: unknown question id ${id}`);
  return { total, translated };
}

/** The 40-chapter bank: Chinese shown under each image, plus its reviewable source. */
function checkRegularTranslations() {
  const bank = JSON.parse(fs.readFileSync(path.join(PUBLIC, "data", "questions.json"), "utf8"));
  const byId = new Map(bank.map((q) => [q.id, q]));
  const published = JSON.parse(fs.readFileSync(path.join(PUBLIC, "data", "questions.zh.json"), "utf8"));
  const zh = published.questions || {};

  for (const [id, entry] of Object.entries(zh)) {
    const q = byId.get(id);
    if (!q) { errors.push(`questions.zh.json: unknown question id ${id}`); continue; }
    const options = Array.isArray(entry.options) ? entry.options : [];
    check(typeof entry.question === "string" && entry.question.trim(), `${id}: empty Chinese question`);
    check(options.length >= 2 && options.length <= 5, `${id}: ${options.length} options (expected 2–5)`);
    check(q.correctAnswer <= options.length,
      `${id}: answer key is ${q.correctAnswer} but only ${options.length} options were transcribed`);
    options.forEach((o, i) => check(String(o).trim(), `${id}: Chinese option ${i + 1} is blank`));
    check(!("correctAnswer" in entry) && !("answer" in entry), `${id}: translation must not carry answers`);
    // "ЗОГС" is printed on the sign / road marking itself, so it is quoted as-is.
    const text = (entry.question + " " + options.join(" ")).replace(/ЗОГС/gi, "");
    check(!/[А-Яа-яЁёӨөҮү]{3,}/.test(text), `${id}: untranslated Mongolian left in the Chinese text`);
  }

  // The published file must be exactly what the source generates.
  const sourceDir = path.join(ROOT, "data-source", "regular-zh");
  if (fs.existsSync(sourceDir)) {
    let sourceCount = 0;
    for (const file of fs.readdirSync(sourceDir).filter((f) => /^chapter-\d{2}\.json$/.test(f))) {
      const entries = JSON.parse(fs.readFileSync(path.join(sourceDir, file), "utf8"));
      for (const [id, entry] of Object.entries(entries)) {
        sourceCount += 1;
        const mnOptions = (entry.mn && entry.mn.options) || [];
        const zhOptions = (entry.zh && entry.zh.options) || [];
        check(mnOptions.length === zhOptions.length,
          `${file} ${id}: ${mnOptions.length} Mongolian vs ${zhOptions.length} Chinese options`);
        check(JSON.stringify(zh[id]) === JSON.stringify({ question: entry.zh && entry.zh.question, options: zhOptions }),
          `${id}: public/data/questions.zh.json is out of date — run npm run generate:regular-zh`);
      }
    }
    check(sourceCount === Object.keys(zh).length,
      `questions.zh.json has ${Object.keys(zh).length} entries, source has ${sourceCount} — regenerate it`);
  }
  return { total: bank.length, translated: Object.keys(zh).length };
}

function main() {
  const dictionaries = loadDictionaries();
  if (errors.length) return finish();

  const [mn, zh] = [dictionaries.mn, dictionaries.zh];
  for (const key of Object.keys(mn)) check(key in zh, `zh.js is missing key "${key}"`);
  for (const key of Object.keys(zh)) check(key in mn, `mn.js is missing key "${key}"`);
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(dictionaries[lang])) {
      check(typeof value === "string", `${lang}.js "${key}" is not a string`);
      if (!MAY_BE_BLANK[lang].includes(key)) check(String(value).trim(), `${lang}.js "${key}" is blank`);
    }
  }
  for (const key of Object.keys(mn)) {
    if (key in zh && MAY_BE_BLANK.mn.indexOf(key) === -1) {
      check(placeholders(mn[key]) === placeholders(zh[key]),
        `"${key}" placeholders differ: mn [${placeholders(mn[key])}] vs zh [${placeholders(zh[key])}]`);
    }
  }

  const used = usedKeys();
  for (const [key, file] of used) check(key in mn, `${file} uses unknown key "${key}"`);

  const q = checkQuestionTranslations();
  const r = checkRegularTranslations();

  console.log("=== I18N VALIDATION REPORT ===");
  console.log(`Dictionary keys:  mn ${Object.keys(mn).length} · zh ${Object.keys(zh).length}`);
  console.log(`Keys used in UI:  ${used.size}`);
  console.log(`Дүрмийн тест:     ${r.translated} / ${r.total} questions have Chinese`);
  console.log(`Ангилал ахиулах:  ${q.translated} / ${q.total} questions have Chinese`);
  finish();
}

function finish() {
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):`);
    errors.forEach((e) => console.error("  ✗ " + e));
    process.exit(1);
  }
  console.log("\nAll checks passed ✓");
}

main();
