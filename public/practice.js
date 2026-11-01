/* Quiz engine: learning mode (instant feedback) and exam mode (score at end).
   Keyboard: 1–5 answer, ←/→ navigate, Enter next. Progress saved to localStorage. */
(function () {
  "use strict";

  const P = window.Platform;
  const I18N = window.I18N;
  const t = I18N.t;
  I18N.boot();
  const params = new URLSearchParams(location.search);
  const chapterId = Math.min(Math.max(parseInt(params.get("chapter"), 10) || 1, 1), P.TOTAL_CHAPTERS);
  let mode = params.get("mode") === "exam" ? "exam" : params.get("mode") === "learning" ? "learning" : null;

  const progress = P.loadProgress();
  const chState = P.chapterState(progress, chapterId);

  let questions = [];
  let index = 0;
  let answers = {}; // questionNumber → selected option
  let startedAt = Date.now();
  let finished = false;
  let timerInterval = null;
  let advanceTimeout = null;
  let translations = {}; // question id → { question, options } (display only)

  /* ---------- Elements ---------- */
  const el = {
    chapterTitle: document.getElementById("chapter-title"),
    counter: document.getElementById("question-counter"),
    modeChip: document.getElementById("mode-chip"),
    progressFill: document.getElementById("quiz-progress-fill"),
    progressBar: document.getElementById("quiz-progressbar"),
    questionLabel: document.getElementById("question-label"),
    image: document.getElementById("question-image"),
    skeleton: document.getElementById("image-skeleton"),
    answers: document.getElementById("answers"),
    answerBtns: Array.from(document.querySelectorAll(".answer-btn")),
    feedback: document.getElementById("feedback"),
    prevBtn: document.getElementById("prev-btn"),
    nextBtn: document.getElementById("next-btn"),
    dots: document.getElementById("question-dots"),
    quizArea: document.getElementById("quiz-area"),
    resultsArea: document.getElementById("results-area"),
    errorArea: document.getElementById("error-area"),
    modeOverlay: document.getElementById("mode-overlay"),
    modeChapterLabel: document.getElementById("mode-chapter-label"),
    examTimer: document.getElementById("exam-timer"),
    translation: document.getElementById("question-translation"),
    themeToggle: document.getElementById("theme-toggle")
  };

  function syncThemeIcon() {
    el.themeToggle.textContent = P.getTheme() === "dark" ? "☀️" : "🌙";
  }
  el.themeToggle.addEventListener("click", () => { P.toggleTheme(); syncThemeIcon(); });
  syncThemeIcon();

  el.chapterTitle.textContent = t("chapter.name", { chapter: chapterId });
  el.counter.textContent = t("practice.counterPlaceholder", { total: P.QUESTIONS_PER_CHAPTER });
  el.modeChapterLabel.textContent = t("practice.modeChapterLabel", { chapter: chapterId });
  document.title = t("title.chapter", { chapter: chapterId });

  /* ---------- Session persistence ---------- */

  function saveSession() {
    if (finished) return;
    chState.session = { mode, index, answers, startedAt };
    progress.lastChapter = chapterId;
    progress.lastMode = mode;
    P.saveProgress(progress);
  }

  function restoreSession(session) {
    mode = session.mode;
    answers = session.answers || {};
    index = Math.min(session.index || 0, 19);
    startedAt = session.startedAt || Date.now();
  }

  /* ---------- Rendering ---------- */

  function currentQuestion() { return questions[index]; }

  function answeredCount() { return Object.keys(answers).length; }

  function preload(i) {
    if (i >= 0 && i < questions.length) {
      const img = new Image();
      img.src = questions[i].imagePath;
    }
  }

  function renderQuestion() {
    const q = currentQuestion();
    el.counter.textContent = t("practice.counter", { n: index + 1, total: questions.length });
    el.questionLabel.textContent = t("practice.question", { n: index + 1 });

    el.skeleton.classList.remove("hidden");
    el.image.classList.remove("loaded");
    el.image.src = q.imagePath;
    el.image.alt = t("practice.imageAltChapter", { chapter: chapterId, n: q.questionNumber });
    if (el.image.complete && el.image.naturalWidth) onImageLoad();
    renderTranslation(q);

    const selected = answers[q.questionNumber];
    const revealed = mode === "learning" && selected !== undefined;

    el.answerBtns.forEach((btn) => {
      const n = Number(btn.dataset.answer);
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
    });

    el.feedback.className = "feedback-area";
    if (revealed) {
      const good = selected === q.correctAnswer;
      el.feedback.classList.add("show", good ? "good" : "bad");
      const correctText = translatedOption(q, q.correctAnswer);
      el.feedback.textContent = good
        ? t("practice.correct")
        : correctText
          ? t("practice.wrongWithText", { answer: q.correctAnswer, text: correctText })
          : t("practice.wrong", { answer: q.correctAnswer });
    }

    el.prevBtn.disabled = index === 0;
    const last = index === questions.length - 1;
    el.nextBtn.textContent = last ? t("practice.finish") : t("practice.next");

    el.progressFill.style.width = (answeredCount() / questions.length) * 100 + "%";
    el.progressBar.setAttribute("aria-valuenow", String(answeredCount()));

    renderDots();
    preload(index + 1);
    preload(index + 2);
  }

  /** Translated text of option n (1-based), or "" when there is no translation. */
  function translatedOption(q, n) {
    const entry = translations[q.id];
    return entry && Array.isArray(entry.options) && entry.options[n - 1] ? entry.options[n - 1] : "";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /** Translated question and correct option under a mistake's image (results page). */
  function mistakeTranslation(q) {
    const entry = translations[q.id];
    if (!entry || !entry.question) return "";
    const correct = translatedOption(q, q.correctAnswer);
    return '<div class="question-translation mistake-translation">' +
      '<div class="qt-label">' + escapeHtml(t("practice.translation")) + "</div>" +
      '<p class="qt-question">' + escapeHtml(entry.question) + "</p>" +
      (correct ? '<p class="qt-correct">' + q.correctAnswer + ". " + escapeHtml(correct) + "</p>" : "") +
    "</div>";
  }

  /* The question itself is printed in the image (Mongolian). In Chinese the
     translated text is shown underneath when the overlay has it; otherwise a
     short note explains the image is the original. Never replaces the image. */
  function renderTranslation(q) {
    if (!el.translation) return;
    const entry = translations[q.id];
    el.translation.innerHTML = "";
    if (entry && entry.question) {
      const label = document.createElement("div");
      label.className = "qt-label";
      label.textContent = t("practice.translation");
      const text = document.createElement("p");
      text.className = "qt-question";
      text.textContent = entry.question;
      el.translation.appendChild(label);
      el.translation.appendChild(text);
      if (Array.isArray(entry.options) && entry.options.length) {
        const list = document.createElement("ol");
        list.className = "qt-options";
        entry.options.forEach((option) => {
          const li = document.createElement("li");
          li.textContent = option;
          list.appendChild(li);
        });
        el.translation.appendChild(list);
      }
      el.translation.hidden = false;
      return;
    }
    const note = t("practice.imageOnlyNote");
    el.translation.hidden = !note;
    if (note) {
      const p = document.createElement("p");
      p.className = "qt-note";
      p.textContent = note;
      el.translation.appendChild(p);
    }
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
      dot.addEventListener("click", () => { goTo(i); });
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
    if (index === questions.length - 1) {
      maybeFinish();
    } else {
      goTo(index + 1);
    }
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

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(timerInterval);
    clearTimeout(advanceTimeout);

    const score = questions.reduce(
      (sum, q) => sum + (answers[q.questionNumber] === q.correctAnswer ? 1 : 0), 0);
    const durationSec = (Date.now() - startedAt) / 1000;
    P.recordAttempt(progress, chapterId, mode, score, questions.length, durationSec);
    P.syncActivity({ type: "attempt", chapterId, mode, score, durationSec: Math.round(durationSec) });
    renderResults(score);
  }

  function renderResults(score) {
    const total = questions.length;
    const passed = score >= P.PASS_SCORE;
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
            ? t("results.passedChapter")
            : t("results.failedDetail", { total, pass: P.PASS_SCORE })) +
        "</p>" +
        '<div class="results-actions">' +
          '<button class="btn btn-primary" id="retry-btn" type="button">' + t("results.retry") + "</button>" +
          (chapterId < P.TOTAL_CHAPTERS
            ? '<a class="btn btn-soft" href="/practice?chapter=' + (chapterId + 1) + '">' + t("results.nextChapter") + "</a>"
            : "") +
          '<a class="btn btn-ghost" href="/">' + t("results.home") + "</a>" +
        "</div>" +
      "</div>" +
      (mistakes.length
        ? '<div class="section-header"><h2 class="section-title">' +
            t("results.mistakes", { count: mistakes.length }) + "</h2></div>" +
          '<div class="mistake-list">' +
          mistakes.map((q) =>
            '<div class="mistake-item">' +
              '<div class="mistake-meta"><span>' + t("practice.question", { n: q.questionNumber }) + "</span>" +
                '<span class="your">' + t("results.yourAnswer", { answer: answers[q.questionNumber] }) + "</span>" +
                '<span class="right">' + t("results.correctAnswer", { answer: q.correctAnswer }) + "</span></div>" +
              '<img src="' + q.imagePath + '" alt="' +
                t("practice.imageAltChapter", { chapter: chapterId, n: q.questionNumber }) + '" loading="lazy"/>' +
              mistakeTranslation(q) +
            "</div>"
          ).join("") +
          "</div>"
        : '<div class="empty-state">' + t("results.noMistakes") + "</div>");

    document.getElementById("retry-btn").addEventListener("click", restart);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function restart() {
    finished = false;
    answers = {};
    index = 0;
    startedAt = Date.now();
    chState.session = null;
    P.saveProgress(progress);
    el.resultsArea.hidden = true;
    el.quizArea.hidden = false;
    if (mode === "exam") startTimer();
    renderQuestion();
    saveSession();
  }

  /* ---------- Exam timer ---------- */

  function startTimer() {
    el.examTimer.hidden = false;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      el.examTimer.textContent =
        String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
    }, 1000);
  }

  /* ---------- Events ---------- */

  el.answerBtns.forEach((btn) => {
    btn.addEventListener("click", () => selectAnswer(Number(btn.dataset.answer)));
  });
  el.prevBtn.addEventListener("click", () => goTo(index - 1));
  el.nextBtn.addEventListener("click", nextOrFinish);

  document.addEventListener("keydown", (e) => {
    if (el.modeOverlay && !el.modeOverlay.hidden) return;
    if (finished) return;
    if (e.key >= "1" && e.key <= "5") {
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

  /** Optional per-language overlay for the image-only questions. Missing or
      broken overlays are ignored: the original images always work. */
  function loadTranslations() {
    if (I18N.lang === I18N.DEFAULT_LANG) return Promise.resolve({});
    return fetch("/public/data/questions." + I18N.lang + ".json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => (data && data.questions) || {})
      .catch(() => ({}));
  }

  function begin(selectedMode, resumeSession) {
    mode = selectedMode;
    el.modeOverlay.hidden = true;
    el.modeChip.textContent = mode === "exam" ? t("mode.exam") : t("mode.learning");
    el.modeChip.classList.toggle("exam", mode === "exam");
    if (resumeSession) restoreSession(resumeSession);
    if (mode === "exam") startTimer();
    renderQuestion();
    saveSession();
    if (!resumeSession) {
      P.syncActivity({ type: "chapter_start", chapterId, mode });
    }
    P.startHeartbeat(() => ({ chapterId, questionNumber: index + 1 }));
  }

  Promise.all([P.requireStudent(), P.loadQuestions(), loadTranslations()])
    .then(([student, all, overlay]) => {
      translations = overlay;
      const entitlements = student.entitlements || ["regular"];
      if (entitlements.indexOf("regular") === -1) {
        throw new Error(t("practice.noRegular"));
      }
      questions = P.questionsForChapter(all, chapterId);
      if (questions.length !== P.QUESTIONS_PER_CHAPTER) {
        throw new Error(t("practice.incomplete", { chapter: chapterId, count: questions.length }));
      }

      const session = chState.session;
      if (mode) {
        // Mode given in URL: resume only if same mode.
        begin(mode, session && session.mode === mode ? session : null);
      } else if (session && session.answers && Object.keys(session.answers).length) {
        // Unfinished session exists — resume it directly.
        begin(session.mode, session);
      } else {
        el.modeOverlay.hidden = false;
        document.getElementById("mode-learning").addEventListener("click", () => begin("learning", null));
        document.getElementById("mode-exam").addEventListener("click", () => begin("exam", null));
      }
    })
    .catch((err) => {
      el.quizArea.hidden = true;
      el.errorArea.innerHTML = "";
      const banner = document.createElement("div");
      banner.className = "error-banner";
      banner.textContent = t("common.errorReload", { message: err.message });
      el.errorArea.appendChild(banner);
    });

  window.addEventListener("pagehide", saveSession);
})();
