/* Quiz engine: learning mode (instant feedback) and exam mode (score at end).
   Keyboard: 1–5 answer, ←/→ navigate, Enter next. Progress saved to localStorage. */
(function () {
  "use strict";

  const P = window.Platform;
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
    themeToggle: document.getElementById("theme-toggle")
  };

  function syncThemeIcon() {
    el.themeToggle.textContent = P.getTheme() === "dark" ? "☀️" : "🌙";
  }
  el.themeToggle.addEventListener("click", () => { P.toggleTheme(); syncThemeIcon(); });
  syncThemeIcon();

  el.chapterTitle.textContent = "Бүлэг " + chapterId;
  el.modeChapterLabel.textContent = "Бүлэг " + chapterId + " · 20 асуулт";
  document.title = "Бүлэг " + chapterId + " — Жолооны дүрмийн тест";

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
    el.counter.textContent = "Асуулт " + (index + 1) + " / " + questions.length;
    el.questionLabel.textContent = "Асуулт " + (index + 1);

    el.skeleton.classList.remove("hidden");
    el.image.classList.remove("loaded");
    el.image.src = q.imagePath;
    el.image.alt = "Бүлэг " + chapterId + ", асуулт " + q.questionNumber + "-ийн зураг";
    if (el.image.complete && el.image.naturalWidth) onImageLoad();

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
      el.feedback.textContent = good
        ? "Зөв байна! 🎉"
        : "Буруу байна. Зөв хариулт: " + q.correctAnswer;
    }

    el.prevBtn.disabled = index === 0;
    const last = index === questions.length - 1;
    el.nextBtn.textContent = last ? "Дуусгах ✓" : "Дараах →";

    el.progressFill.style.width = (answeredCount() / questions.length) * 100 + "%";
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
    el.image.alt = "Зураг ачаалагдсангүй — дахин оролдоно уу";
  });

  function renderDots() {
    el.dots.innerHTML = "";
    questions.forEach((q, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "dot";
      dot.textContent = i + 1;
      dot.setAttribute("aria-label", "Асуулт " + (i + 1) + " руу очих");
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
      el.feedback.textContent = unanswered.length + " асуулт хариулаагүй байна — " +
        (firstIdx + 1) + "-р асуултаас үргэлжлүүлнэ үү.";
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
        '<div class="results-ring" role="img" aria-label="Оноо ' + score + " / " + total + '">' +
          '<svg width="130" height="130" viewBox="0 0 130 130">' +
            '<circle cx="65" cy="65" r="56" fill="none" stroke="var(--bg-subtle)" stroke-width="11"/>' +
            '<circle cx="65" cy="65" r="56" fill="none" stroke="' + ringColor + '" stroke-width="11" ' +
              'stroke-linecap="round" stroke-dasharray="' + dash + " " + circumference + '"/>' +
          "</svg>" +
          '<div class="results-ring-label">' + score + "/" + total + "</div>" +
        "</div>" +
        '<p class="results-verdict">' + (passed ? "Тэнцлээ! 🎉" : "Тэнцсэнгүй 😔") + "</p>" +
        '<p class="results-detail">' +
          (passed
            ? "Маш сайн! Та энэ бүлгийг амжилттай давлаа."
            : "Тэнцэхийн тулд 20 асуултаас дор хаяж " + P.PASS_SCORE + " зөв хариулах хэрэгтэй. Дахин оролдоорой!") +
        "</p>" +
        '<div class="results-actions">' +
          '<button class="btn btn-primary" id="retry-btn" type="button">Дахин эхлэх</button>' +
          (chapterId < P.TOTAL_CHAPTERS
            ? '<a class="btn btn-soft" href="/practice?chapter=' + (chapterId + 1) + '">Дараагийн бүлэг →</a>'
            : "") +
          '<a class="btn btn-ghost" href="/">Нүүр хуудас</a>' +
        "</div>" +
      "</div>" +
      (mistakes.length
        ? '<div class="section-header"><h2 class="section-title">Алдсан асуултууд (' + mistakes.length + ')</h2></div>' +
          '<div class="mistake-list">' +
          mistakes.map((q) =>
            '<div class="mistake-item">' +
              '<div class="mistake-meta"><span>Асуулт ' + q.questionNumber + "</span>" +
                '<span class="your">Таны хариулт: ' + answers[q.questionNumber] + "</span>" +
                '<span class="right">Зөв хариулт: ' + q.correctAnswer + "</span></div>" +
              '<img src="' + q.imagePath + '" alt="Асуулт ' + q.questionNumber + '-ийн зураг" loading="lazy"/>' +
            "</div>"
          ).join("") +
          "</div>"
        : '<div class="empty-state">Бүх асуултад зөв хариуллаа — алдаа алга! 💯</div>');

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

  function begin(selectedMode, resumeSession) {
    mode = selectedMode;
    el.modeOverlay.hidden = true;
    el.modeChip.textContent = mode === "exam" ? "Шалгалт" : "Сургалт";
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

  Promise.all([P.requireStudent(), P.loadQuestions()])
    .then(([student, all]) => {
      const entitlements = student.entitlements || ["regular"];
      if (entitlements.indexOf("regular") === -1) {
        throw new Error("Танд дүрмийн тестийн эрх олгогдоогүй байна. Багштайгаа холбогдоно уу.");
      }
      questions = P.questionsForChapter(all, chapterId);
      if (questions.length !== P.QUESTIONS_PER_CHAPTER) {
        throw new Error("Бүлэг " + chapterId + "-ийн өгөгдөл дутуу байна (" + questions.length + "/20).");
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
      banner.textContent = "Алдаа гарлаа: " + err.message + " — Хуудсыг дахин ачаална уу.";
      el.errorArea.appendChild(banner);
    });

  window.addEventListener("pagehide", saveSession);
})();
