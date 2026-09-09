#!/usr/bin/env node
/**
 * End-to-end tests for the "Ангилал ахиулах" feature and for the regular
 * course it must not disturb. Boots the real server against a throwaway
 * DATA_DIR, so nothing here can touch live student data.
 *
 * Usage: node scripts/test-category-upgrade.js
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const PORT = 3400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TEACHER_PASSWORD = "test-teacher-password";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "driving-test-"));

let passed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

function request(method, url, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      BASE + url,
      {
        method,
        headers: Object.assign(
          {},
          token ? { Authorization: "Bearer " + token } : {},
          payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}
        )
      },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch (err) { parsed = data; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function waitForServer(attempts = 60) {
  return new Promise((resolve, reject) => {
    const tryOnce = (left) => {
      const req = http.get(BASE + "/login", (res) => { res.resume(); resolve(); });
      req.on("error", () => {
        if (left <= 0) reject(new Error("server did not start"));
        else setTimeout(() => tryOnce(left - 1), 100);
      });
    };
    tryOnce(attempts);
  });
}

async function run() {
  console.log(`Ангилал ахиулах — end-to-end tests (port ${PORT}, data ${DATA_DIR})\n`);

  /* ---------- teacher: grant the three entitlement shapes ---------- */
  const login = await request("POST", "/api/teacher/login", { body: { password: TEACHER_PASSWORD } });
  check("teacher can sign in", login.status === 200 && !!login.body.token, `status ${login.status}`);
  const teacher = login.body.token;

  async function createStudent(name, entitlements) {
    const res = await request("POST", "/api/teacher/students", {
      token: teacher,
      body: { name, entitlements }
    });
    return res;
  }

  const regularOnly = await createStudent("Сурагч A", ["regular"]);
  const upgradeOnly = await createStudent("Сурагч B", ["category_upgrade"]);
  const bothAreas = await createStudent("Сурагч C", ["regular", "category_upgrade"]);
  const defaulted = await request("POST", "/api/teacher/students", {
    token: teacher,
    body: { name: "Сурагч D" }
  });

  check("teacher can register a regular-only student",
    regularOnly.status === 201 &&
    JSON.stringify(regularOnly.body.student.entitlements) === JSON.stringify(["regular"]),
    JSON.stringify(regularOnly.body));
  check("teacher can grant Ангилал ахиулах on its own",
    upgradeOnly.status === 201 &&
    JSON.stringify(upgradeOnly.body.student.entitlements) === JSON.stringify(["category_upgrade"]));
  check("teacher can grant both areas",
    bothAreas.status === 201 && bothAreas.body.student.entitlements.length === 2);
  check("a student created without entitlements defaults to the regular course",
    JSON.stringify(defaulted.body.student.entitlements) === JSON.stringify(["regular"]));
  check("access codes still use the existing DRV-XXXX-XXXX format",
    /^DRV-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(upgradeOnly.body.student.code),
    upgradeOnly.body.student.code);

  /* ---------- students sign in with the existing code mechanism ---------- */
  async function studentLogin(code) {
    const res = await request("POST", "/api/student/login", { body: { code } });
    return res.body.token;
  }
  const tokenRegular = await studentLogin(regularOnly.body.student.code);
  const tokenUpgrade = await studentLogin(upgradeOnly.body.student.code);
  const tokenBoth = await studentLogin(bothAreas.body.student.code);
  check("students sign in with their access code",
    !!tokenRegular && !!tokenUpgrade && !!tokenBoth);

  /* ---------- Case A: regular-only student is denied ---------- */
  const denied = await request("GET", "/api/category-upgrade/catalog", { token: tokenRegular });
  check("Case A — regular-only student cannot open the Ангилал ахиулах catalog",
    denied.status === 403, `status ${denied.status}`);
  const deniedTest = await request("GET", "/api/category-upgrade/tests/1", { token: tokenRegular });
  check("Case A — regular-only student cannot fetch a category-upgrade test",
    deniedTest.status === 403, `status ${deniedTest.status}`);
  const deniedAttempt = await request("POST", "/api/category-upgrade/attempt", {
    token: tokenRegular,
    body: { testNumber: 1, answers: {} }
  });
  check("Case A — regular-only student cannot submit a category-upgrade attempt",
    deniedAttempt.status === 403, `status ${deniedAttempt.status}`);
  check("Case A — /api/student/me reports only the regular entitlement",
    JSON.stringify((await request("GET", "/api/student/me", { token: tokenRegular })).body.student
      .entitlements) === JSON.stringify(["regular"]));

  /* ---------- Case B: upgrade-only student gets all 20 tests ---------- */
  const catalog = await request("GET", "/api/category-upgrade/catalog", { token: tokenUpgrade });
  check("Case B — catalog lists 20 tests", catalog.status === 200 && catalog.body.tests.length === 20,
    `status ${catalog.status}`);
  check("Case B — catalog reports the display name",
    catalog.body.displayName === "Ангилал ахиулах", catalog.body.displayName);
  check("Case B — every catalog entry declares 10 questions",
    catalog.body.tests.every((t) => t.questionCount === 10));

  let totalQuestions = 0;
  let optionProblems = 0;
  let imageProblems = 0;
  for (let t = 1; t <= 20; t += 1) {
    const res = await request("GET", `/api/category-upgrade/tests/${t}`, { token: tokenUpgrade });
    if (res.status !== 200 || !Array.isArray(res.body.questions)) {
      optionProblems += 1;
      continue;
    }
    totalQuestions += res.body.questions.length;
    if (res.body.questions.length !== 10) optionProblems += 1;
    for (const q of res.body.questions) {
      if (!q.question || !Array.isArray(q.options) || q.options.length < 2) optionProblems += 1;
      if (!Number.isInteger(q.correctAnswer) || q.correctAnswer < 1 ||
          q.correctAnswer > q.options.length) optionProblems += 1;
      if (q.imagePath) {
        const onDisk = path.join(ROOT, q.imagePath.replace(/^\/public\//, "public/"));
        if (!fs.existsSync(onDisk)) imageProblems += 1;
      }
    }
  }
  check("Case B — all 20 tests open", optionProblems === 0, `${optionProblems} problem(s)`);
  check("Case B — 200 questions in total", totalQuestions === 200, `got ${totalQuestions}`);
  check("Case B — every referenced image resolves on disk", imageProblems === 0,
    `${imageProblems} missing`);

  const upgradeMe = await request("GET", "/api/student/me", { token: tokenUpgrade });
  check("Case B — the student gains no unrelated permission",
    JSON.stringify(upgradeMe.body.student.entitlements) === JSON.stringify(["category_upgrade"]));
  const chapterBlocked = await request("POST", "/api/student/activity", {
    token: tokenUpgrade,
    body: { type: "attempt", chapterId: 1, mode: "exam", score: 20 }
  });
  check("Case B — the student cannot record progress in the 40-chapter course",
    chapterBlocked.status === 403, `status ${chapterBlocked.status}`);

  /* ---------- Case C: student with both areas ---------- */
  const bothCatalog = await request("GET", "/api/category-upgrade/catalog", { token: tokenBoth });
  const bothChapter = await request("POST", "/api/student/activity", {
    token: tokenBoth,
    body: { type: "attempt", chapterId: 3, mode: "exam", score: 19, durationSec: 120 }
  });
  check("Case C — student with both areas opens the category-upgrade catalog",
    bothCatalog.status === 200);
  check("Case C — student with both areas still records chapter progress",
    bothChapter.status === 200, `status ${bothChapter.status}`);

  /* ---------- Case D: unauthenticated / invalid ---------- */
  const anon = await request("GET", "/api/category-upgrade/catalog");
  const badToken = await request("GET", "/api/category-upgrade/tests/1", { token: "not-a-token" });
  const badCode = await request("POST", "/api/student/login", { body: { code: "DRV-0000-0000" } });
  check("Case D — no session is refused", anon.status === 401, `status ${anon.status}`);
  check("Case D — an invalid token is refused", badToken.status === 401, `status ${badToken.status}`);
  check("Case D — an unknown access code cannot sign in", badCode.status === 404,
    `status ${badCode.status}`);

  /* ---------- scoring ---------- */
  const test7 = await request("GET", "/api/category-upgrade/tests/7", { token: tokenUpgrade });
  const questions = test7.body.questions;

  const allRight = {};
  for (const q of questions) allRight[String(q.questionNumber)] = q.correctAnswer;
  const perfect = await request("POST", "/api/category-upgrade/attempt", {
    token: tokenUpgrade,
    body: { testNumber: 7, answers: allRight, durationSec: 300 }
  });
  check("scoring — a perfect paper scores 10/10 and passes",
    perfect.status === 200 && perfect.body.score === 10 && perfect.body.total === 10 &&
    perfect.body.passed === true,
    JSON.stringify(perfect.body && { s: perfect.body.score, p: perfect.body.passed }));

  const halfRight = {};
  questions.forEach((q, i) => {
    halfRight[String(q.questionNumber)] = i < 5
      ? q.correctAnswer
      : (q.correctAnswer % q.options.length) + 1;
  });
  const half = await request("POST", "/api/category-upgrade/attempt", {
    token: tokenUpgrade,
    body: { testNumber: 7, answers: halfRight, durationSec: 200 }
  });
  check("scoring — five correct answers score 5/10 and fail",
    half.status === 200 && half.body.score === 5 && half.body.passed === false,
    JSON.stringify(half.body && { s: half.body.score, p: half.body.passed }));

  const blank = await request("POST", "/api/category-upgrade/attempt", {
    token: tokenUpgrade,
    body: { testNumber: 7, answers: {}, durationSec: 5 }
  });
  check("scoring — an empty paper scores 0/10", blank.status === 200 && blank.body.score === 0);

  const cheated = await request("POST", "/api/category-upgrade/attempt", {
    token: tokenUpgrade,
    body: { testNumber: 7, answers: {}, score: 10, durationSec: 5 }
  });
  check("scoring — a score sent by the client is ignored",
    cheated.status === 200 && cheated.body.score === 0, JSON.stringify(cheated.body.score));

  /* ---------- results are persisted and kept separate ---------- */
  const progress = await request("GET", "/api/student/progress", { token: tokenUpgrade });
  check("results — the best score is remembered",
    progress.body.categoryUpgrade &&
    progress.body.categoryUpgrade.tests.some((t) => t.testNumber === 7 && t.bestScore === 10),
    JSON.stringify(progress.body.categoryUpgrade && progress.body.categoryUpgrade.tests));
  check("results — category-upgrade work does not appear as chapter progress",
    progress.body.summary.chaptersStarted === 0,
    `chaptersStarted ${progress.body.summary.chaptersStarted}`);

  const bothProgress = await request("GET", "/api/student/progress", { token: tokenBoth });
  check("results — the two areas are tracked independently",
    bothProgress.body.summary.chaptersStarted === 1 &&
    bothProgress.body.categoryUpgrade.testsStarted === 0);

  /* ---------- revoking and re-granting ---------- */
  const revoked = await request("PATCH", "/api/teacher/students/" + bothAreas.body.student.id, {
    token: teacher,
    body: { entitlements: ["regular"] }
  });
  check("teacher can revoke the Ангилал ахиулах entitlement",
    revoked.status === 200 &&
    JSON.stringify(revoked.body.student.entitlements) === JSON.stringify(["regular"]));
  const afterRevoke = await request("GET", "/api/category-upgrade/catalog", { token: tokenBoth });
  check("a revoked entitlement is enforced immediately", afterRevoke.status === 403,
    `status ${afterRevoke.status}`);
  const emptyGrant = await request("PATCH", "/api/teacher/students/" + bothAreas.body.student.id, {
    token: teacher,
    body: { entitlements: [] }
  });
  check("a student cannot be left with no entitlement at all", emptyGrant.status === 400,
    `status ${emptyGrant.status}`);

  /* ---------- the regular course is untouched ---------- */
  const questionsFile = path.join(ROOT, "public", "data", "questions.json");
  const regularQuestions = JSON.parse(fs.readFileSync(questionsFile, "utf8"));
  check("regression — the 40-chapter bank still holds 800 questions",
    regularQuestions.length === 800, `${regularQuestions.length}`);
  const regularProgress = await request("GET", "/api/student/progress", { token: tokenRegular });
  check("regression — regular students still reach their progress endpoint",
    regularProgress.status === 200 && regularProgress.body.summary.totalChapters === 40);
  const teacherList = await request("GET", "/api/teacher/students", { token: teacher });
  check("regression — the teacher roster still lists every student",
    teacherList.status === 200 && teacherList.body.students.length === 4,
    `${teacherList.body.students && teacherList.body.students.length}`);
  check("regression — roster rows carry their entitlements",
    teacherList.body.students.every((s) => Array.isArray(s.entitlements)));

  /* ---------- an existing student record migrates non-destructively ---------- */
  const storeFile = path.join(DATA_DIR, "store.json");
  const store = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  const legacy = JSON.parse(JSON.stringify(store.students[0]));
  delete legacy.entitlements;
  delete legacy.platform;
  legacy.id = "legacy-student-id";
  legacy.code = "DRV-LEG1-CODE";
  legacy.name = "Хуучин сурагч";
  store.students.push(legacy);
  fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));
  await restartServer();

  const legacyLogin = await request("POST", "/api/student/login", { body: { code: "DRV-LEG1-CODE" } });
  check("migration — a record saved before entitlements existed can still sign in",
    legacyLogin.status === 200, `status ${legacyLogin.status}`);
  const legacyMe = await request("GET", "/api/student/me", { token: legacyLogin.body.token });
  check("migration — it defaults to the regular course only",
    JSON.stringify(legacyMe.body.student.entitlements) === JSON.stringify(["regular"]));
  const legacyDenied = await request("GET", "/api/category-upgrade/catalog", {
    token: legacyLogin.body.token
  });
  check("migration — it does not silently gain Ангилал ахиулах", legacyDenied.status === 403);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  ✗ " + f);
  }
  return failures.length === 0;
}

let child = null;
let serverLog = "";

function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      DATA_DIR,
      TEACHER_PASSWORD,
      MONGODB_URI: ""
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (d) => { serverLog += d; });
  child.stderr.on("data", (d) => { serverLog += d; });
  return waitForServer();
}

/** The store is held in memory, so a file edit only takes effect on restart. */
async function restartServer() {
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  });
  await new Promise((r) => setTimeout(r, 150));
  await startServer();
}

function cleanup() {
  if (child) child.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (err) { /* ignore */ }
}

startServer()
  .then(run)
  .then((ok) => {
    cleanup();
    process.exit(ok ? 0 : 1);
  })
  .catch((error) => {
    console.error("Test run failed:", error.message);
    if (serverLog) console.error("Server output:\n" + serverLog);
    cleanup();
    process.exit(1);
  });
