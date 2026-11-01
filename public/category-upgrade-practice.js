/* "Ангилал ахиулах" quiz engine. Mirrors the 40-chapter engine: learning mode
   with instant feedback, exam mode with a timer and an end-of-test score.
   Difference: the questions carry option text, and the final score is
   calculated by the server from the submitted answers. */
(function () {
  "use strict";

  const P = window.Platform;
  const I18N = window.I18N;
  const t = I18N.t;
  I18N.boot();
  const params = new URLSearchParams(location.search);
  const testNumber = Math.min(Math.max(parseInt(params.get("test"), 10) || 1, 1), 20);
  let mode = params.get("mode") === "exam" ? "exam" : params.get("mode") === "learning" ? "learning" : null;

  const STORAGE_KEY = "dlp.categoryUpgrade.v1";

  let questions = [];
  let passScore = 8;
  let index = 0;
  let answers = {}; // questionNumber → selected option
  let startedAt = Date.now();
  let finished = false;
  let timerInterval = null;
  let advanceTimeout = null;

  const el = {
    testTitle: document.getElementById("test-title"),
    counter: document.getElementById("question-counter"),
    modeChip: document.getElementById("mode-chip"),
    progressFill: document.getElementById("quiz-progress-fill"),
    progressBar: document.getElementById("quiz-progressbar"),
    questionLabel: document.getElementById("question-label"),
    questionText: document.getElementById("question-text"),
    imageWrap: document.getElementById("image-wrap"),
    image: document.getElementById("question-image"),
    skeleton: document.getElementById("image-skeleton"),
    answers: document.getElementById("answers"),
    feedback: document.getElementById("feedback"),
    prevBtn: document.getElementById("prev-btn"),
    nextBtn: document.getElementById("next-btn"),
    dots: document.getElementById("question-dots"),
    quizArea: document.getElementById("quiz-area"),
    resultsArea: document.getElementById("results-area"),
    errorArea: document.getElementById("error-area"),
    modeOverlay: document.getElementById("mode-overlay"),
    modeTestLabel: document.getElementById("mode-test-label"),
    examTimer: document.getElementById("exam-timer"),
    original: document.getElementById("question-original"),
    originalBody: document.getElementById("question-original-body"),
    themeToggle: document.getElementById("theme-toggle")
  };

  function syncThemeIcon() {
    el.themeToggle.textContent = P.getTheme() === "dark" ? "☀️" : "🌙";
  }
  el.themeToggle.addEventListener("click", () => { P.toggleTheme(); syncThemeIcon(); });
  syncThemeIcon();

  el.testTitle.textContent = t("test.name", { test: testNumber });
  el.counter.textContent = t("practice.counterPlaceholder", { total: 10 });
  el.modeTestLabel.textContent = t("test.name", { test: testNumber });
  document.title = t("title.upgradeTest", { test: testNumber });

  /* ---------- Display language ----------
     The server may attach q.i18n[lang] = { question, options } next to the
     Mongolian original. Only the wording shown changes: option N is still
     answer N, so marking and the stored answers are identical in any language. */

  function translated(q) {
    const entry = q.i18n && q.i18n[I18N.lang];
    if (!entry || typeof entry.question !== "string" || !Array.isArray(entry.options)) return null;
    if (entry.options.length !== q.options.length) return null; // never risk misaligned choices
    return entry;
  }

  function questionText(q) {
    const tr = translated(q);
    return tr ? tr.question : q.question;
  }

  function optionText(q, i) {
    const tr = translated(q);
    return tr ? tr.options[i] : q.options[i];
  }

  /** Builds the collapsible Mongolian original as DOM (no HTML strings). */
  function fillOriginal(container, q) {
    container.innerHTML = "";
    const text = document.createElement("p");
    text.lang = "mn";
    text.textContent = q.question;
    const list = document.createElement("ol");
    list.lang = "mn";
    q.options.forEach((option) => {
      const li = document.createElement("li");
      li.textContent = option;
      list.appendChild(li);
    });
    container.appendChild(text);
    container.appendChild(list);
  }

  /* ---------- Unfinished-session persistence (per test, local only) ---------- */

  function loadSessions() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch (err) {
      return {};
    }
  }

  function saveSession() {
    if (finished) return;
    try {
      const all = loadSessions();
      all[String(testNumber)] = { mode, index, answers, startedAt };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (err) {
      /* storage unavailable — the session simply is not resumable */
    }
  }

  function clearSession() {
    try {
      const all = loadSessions();
      delete all[String(testNumber)];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (err) {
      /* ignore */
    }
  }

  /* ---------- Rendering ---------- */

  function currentQuestion() { return questions[index]; }
  function answeredCount() { return Object.keys(answers).length; }

  function preload(i) {
    if (i >= 0 && i < questions.length && questions[i].imagePath) {
      const img = new Image();
      img.src = questions[i].imagePath;
    }
  }

  function renderQuestion() {
    const q = currentQuestion();
    el.counter.textContent = t("practice.counter", { n: index + 1, total: questions.length });
    el.questionLabel.textContent = t("practice.question", { n: index + 1 });
    el.questionText.textContent = questionText(q);

    const showOriginal = Boolean(translated(q));
    el.original.hidden = !showOriginal;
    if (showOriginal) {
      el.original.open = false;
      fillOriginal(el.originalBody, q);
    }

    if (q.imagePath) {
      el.imageWrap.hidden = false;
      el.skeleton.classList.remove("hidden");
      el.image.classList.remove("loaded");
      el.image.src = q.imagePath;
      el.image.alt = t("upgrade.imageAlt", { test: testNumber, n: q.questionNumber });
      if (el.image.complete && el.image.naturalWidth) onImageLoad();
    } else {
      el.imageWrap.hidden = true;
      el.image.removeAttribute("src");
    }

    const selected = answers[q.questionNumber];
    const revealed = mode === "learning" && selected !== undefined;

    el.answers.innerHTML = "";
    q.options.forEach((_, i) => {
      const n = i + 1;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "answer-btn";
      btn.disabled = revealed || finished;
      if (revealed) {
        if (n === q.correctAnswer) btn.classList.add("correct");
        else if (n === selected) btn.classList.add("wrong");
      } else if (selected === n) {
        btn.classList.add("selected");
      }
      if (finished && mode === "exam") {
        if (n === q.correctAnswer) btn.classList.add("correct");
        else if (n === selected && selected !== q.correctAnswer) btn.classList.add("wrong");
      }
      const badge = document.createElement("span");
      badge.className = "answer-index";
      badge.textContent = String(n);
      const label = document.createElement("span");
      label.textContent = optionText(q, i);
      btn.appendChild(badge);
      btn.appendChild(label);
      btn.addEventListener("click", () => selectAnswer(n));
      el.answers.appendChild(btn);
    });

    el.feedback.className = "feedback-area";
    if (revealed) {
      const good = selected === q.correctAnswer;
      el.feedback.classList.add("show", good ? "good" : "bad");
      el.feedback.textContent = good
        ? t("practice.correct")
        : t("upgrade.wrong", { answer: q.correctAnswer, text: optionText(q, q.correctAnswer - 1) });
    }

    el.prevBtn.disabled = index === 0;
    el.nextBtn.textContent = index === questions.length - 1 ? t("practice.finish") : t("practice.next");

    el.progressFill.style.width = (answeredCount() / questions.length) * 100 + "%";
    el.progressBar.setAttribute("aria-valuemax", String(questions.length));
    el.progressBar.setAttribute("aria-valuenow", String(answeredCount()));

    renderDots();
    preload(index + 1);
    preload(index + 2);
  }

  function onImageLoad() {
    el.skeleton.classList.add("hidden");
    el.image.classList.add("loaded");
  }
  el.image.addEventListener("load", onImageLoad);
  el.image.addEventListener("error", () => {
    el.skeleton.classList.add("hidden");
    el.image.alt = t("practice.imageError");
  });

  function renderDots() {
    el.dots.innerHTML = "";
    questions.forEach((q, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "dot";
      dot.textContent = i + 1;
      dot.setAttribute("aria-label", t("practice.dotAria", { n: i + 1 }));
      const sel = answers[q.questionNumber];
      if (sel !== undefined) {
        if (mode === "learning" || finished) {
          dot.classList.add(sel === q.correctAnswer ? "good" : "bad");
        } else {
          dot.classList.add("answered");
        }
      }
      if (i === index) dot.classList.add("current");
      dot.addEventListener("click", () => goTo(i));
      el.dots.appendChild(dot);
    });
  }

  /* ---------- Navigation / answering ---------- */

  function goTo(i) {
    if (i < 0 || i >= questions.length) return;
    clearTimeout(advanceTimeout);
    index = i;
    renderQuestion();
    saveSession();
  }

  function selectAnswer(n) {
    if (finished) return;
    const q = currentQuestion();
    if (mode === "learning" && answers[q.questionNumber] !== undefined) return;
    answers[q.questionNumber] = n;
    renderQuestion();
    saveSession();

    if (mode === "learning" && n === q.correctAnswer && index < questions.length - 1) {
      advanceTimeout = setTimeout(() => goTo(index + 1), 900);
    }
  }

  function nextOrFinish() {
    if (index === questions.length - 1) maybeFinish();
    else goTo(index + 1);
  }

  function maybeFinish() {
    const unanswered = questions.filter((q) => answers[q.questionNumber] === undefined);
    if (unanswered.length) {
      const firstIdx = questions.indexOf(unanswered[0]);
      el.feedback.className = "feedback-area show bad";
      el.feedback.textContent = t("practice.unanswered", { count: unanswered.length, first: firstIdx + 1 });
      goTo(firstIdx);
      return;
    }
    finish();
  }

  async function finish() {
    if (finished) return;
    finished = true;
    clearInterval(timerInterval);
    clearTimeout(advanceTimeout);
    clearSession();

    const durationSec = Math.round((Date.now() - startedAt) / 1000);
    let outcome;
    try {
      // The server marks the paper; the browser never reports its own score.
      outcome = await P.apiPost("/api/category-upgrade/attempt", {
        testNumber,
        answers,
        durationSec
      });
    } catch (error) {
      const score = questions.reduce(
        (sum, q) => sum + (answers[q.questionNumber] === q.correctAnswer ? 1 : 0), 0);
      outcome = { score, total: questions.length, passScore, passed: score >= passScore };
      showBanner(t("results.saveFailed", { message: error.message }));
    }
    renderResults(outcome);
  }

  function renderResults(outcome) {
    const total = outcome.total;
    const score = outcome.score;
    const passed = outcome.passed;
    const percent = Math.round((score / total) * 100);
    const ringColor = passed ? "var(--success)" : "var(--danger)";
    const circumference = 2 * Math.PI * 56;
    const dash = (percent / 100) * circumference;

    const mistakes = questions.filter((q) => answers[q.questionNumber] !== q.correctAnswer);

    el.quizArea.hidden = true;
    el.resultsArea.hidden = false;
    el.resultsArea.innerHTML =
      '<div class="card results-card">' +
        '<div class="results-ring" role="img" aria-label="' + t("results.scoreAria", { score, total }) + '">' +
          '<svg width="130" height="130" viewBox="0 0 130 130">' +
            '<circle cx="65" cy="65" r="56" fill="none" stroke="var(--bg-subtle)" stroke-width="11"/>' +
            '<circle cx="65" cy="65" r="56" fill="none" stroke="' + ringColor + '" stroke-width="11" ' +
              'stroke-linecap="round" stroke-dasharray="' + dash + " " + circumference + '"/>' +
          "</svg>" +
          '<div class="results-ring-label">' + score + "/" + total + "</div>" +
        "</div>" +
        '<p class="results-verdict">' + (passed ? t("results.passed") : t("results.failed")) + "</p>" +
        '<p class="results-detail">' +
          (passed
            ? t("results.passedTest")
            : t("results.failedDetail", { total, pass: outcome.passScore || passScore })) +
        "</p>" +
        '<div class="results-actions">' +
          '<button class="btn btn-primary" id="retry-btn" type="button">' + t("results.retry") + "</button>" +
          (testNumber < 20
            ? '<a class="btn btn-soft" href="/category-upgrade/practice?test=' + (testNumber + 1) +
              '">' + t("results.nextTest") + "</a>"
            : "") +
          '<a class="btn btn-ghost" href="/category-upgrade">' + t("results.testList") + "</a>" +
        "</div>" +
      "</div>" +
      (mistakes.length
        ? '<div class="section-header"><h2 class="section-title">' +
            t("results.mistakes", { count: mistakes.length }) + "</h2></div>" +
          '<div class="mistake-list">' +
          mistakes.map((q) =>
            '<div class="mistake-item">' +
              '<div class="mistake-meta"><span>' + t("practice.question", { n: q.questionNumber }) + "</span>" +
                '<span class="your">' + t("results.yourAnswer", { answer: answers[q.questionNumber] || "—" }) + "</span>" +
                '<span class="right">' + t("results.correctAnswer", { answer: q.correctAnswer }) + "</span></div>" +
              '<p class="cu-question-text">' + escapeHtml(questionText(q)) + "</p>" +
              '<p class="results-detail">' + q.correctAnswer + ". " +
                escapeHtml(optionText(q, q.correctAnswer - 1)) + "</p>" +
              (translated(q)
                ? '<details class="cu-original"><summary>' + escapeHtml(t("practice.showOriginal")) +
                  '</summary><p lang="mn">' + escapeHtml(q.question) + '</p><p lang="mn">' +
                  q.correctAnswer + ". " + escapeHtml(q.options[q.correctAnswer - 1]) + "</p></details>"
                : "") +
              (q.imagePath
                ? '<img src="' + q.imagePath + '" alt="' +
                  escapeHtml(t("upgrade.imageAlt", { test: testNumber, n: q.questionNumber })) + '" loading="lazy"/>'
                : "") +
            "</div>"
          ).join("") +
          "</div>"
        : '<div class="empty-state">' + t("results.noMistakes") + "</div>");

    document.getElementById("retry-btn").addEventListener("click", restart);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function restart() {
    finished = false;
    answers = {};
    index = 0;
    startedAt = Date.now();
    el.resultsArea.hidden = true;
    el.quizArea.hidden = false;
    if (mode === "exam") startTimer();
    renderQuestion();
    saveSession();
  }

  function startTimer() {
    el.examTimer.hidden = false;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      el.examTimer.textContent =
        String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
    }, 1000);
  }

  function showBanner(message) {
    el.errorArea.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "error-banner";
    banner.textContent = message;
    el.errorArea.appendChild(banner);
  }

  el.prevBtn.addEventListener("click", () => goTo(index - 1));
  el.nextBtn.addEventListener("click", nextOrFinish);

  document.addEventListener("keydown", (e) => {
    if (el.modeOverlay && !el.modeOverlay.hidden) return;
    if (finished) return;
    const q = currentQuestion();
    if (q && e.key >= "1" && e.key <= String(Math.min(q.options.length, 9))) {
      selectAnswer(Number(e.key));
    } else if (e.key === "ArrowLeft") {
      goTo(index - 1);
    } else if (e.key === "ArrowRight") {
      goTo(index + 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      nextOrFinish();
    }
  });

  /* ---------- Boot ---------- */

  function begin(selectedMode, resumeSession) {
    mode = selectedMode;
    el.modeOverlay.hidden = true;
    el.quizArea.hidden = false;
    el.modeChip.textContent = mode === "exam" ? t("mode.exam") : t("mode.learning");
    el.modeChip.classList.toggle("exam", mode === "exam");
    if (resumeSession) {
      answers = resumeSession.answers || {};
      index = Math.min(resumeSession.index || 0, questions.length - 1);
      startedAt = resumeSession.startedAt || Date.now();
    }
    if (mode === "exam") startTimer();
    renderQuestion();
    saveSession();
    P.startHeartbeat(() => ({ seconds: 60 }));
  }

  Promise.all([P.requireStudent(), P.apiGet("/api/category-upgrade/tests/" + testNumber)])
    .then(([, data]) => {
      questions = data.questions;
      passScore = data.passScore;
      if (!questions.length) throw new Error(t("upgrade.empty", { test: testNumber }));

      const session = loadSessions()[String(testNumber)];
      if (mode) {
        begin(mode, session && session.mode === mode ? session : null);
      } else if (session && session.answers && Object.keys(session.answers).length) {
        begin(session.mode, session);
      } else {
        el.modeOverlay.hidden = false;
        document.getElementById("mode-learning").addEventListener("click", () => begin("learning", null));
        document.getElementById("mode-exam").addEventListener("click", () => begin("exam", null));
      }
    })
    .catch((err) => {
      el.quizArea.hidden = true;
      showBanner(t("common.errorWith", { message: err.message }));
    });

  window.addEventListener("pagehide", saveSession);
})();
