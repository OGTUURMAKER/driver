/* Shared core for the learning platform: data loading, progress store,
   streak tracking, theme. No frameworks, no dependencies. */
(function () {
  "use strict";

  const TOTAL_CHAPTERS = 40;
  const QUESTIONS_PER_CHAPTER = 20;
  const PASS_SCORE = 18; // official exam allows max 2 mistakes
  const STORAGE_KEY = "dlp.progress.v1";
  const THEME_KEY = "dlp.theme";
  const MAX_ATTEMPTS_KEPT = 20;

  /* ---------- Theme ---------- */

  function getTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function toggleTheme() {
    const next = getTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    return next;
  }

  applyTheme(getTheme());

  /* ---------- Student auth (Special Access ID sessions) ---------- */

  const TOKEN_KEY = "studentToken";

  function studentToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/login";
  }

  /** Resolves with {name, code, expiresAt} or redirects to /login. */
  let mePromise = null;
  function requireStudent() {
    if (!mePromise) {
      mePromise = (async () => {
        const token = studentToken();
        if (!token) {
          location.href = "/login";
          return new Promise(() => {});
        }
        const res = await fetch("/api/student/me", {
          headers: { Authorization: "Bearer " + token }
        });
        if (!res.ok) {
          localStorage.removeItem(TOKEN_KEY);
          location.href = res.status === 403 ? "/login?expired=1" : "/login";
          return new Promise(() => {});
        }
        const data = await res.json();
        return data.student;
      })();
    }
    return mePromise;
  }

  /** Fire-and-forget activity sync to the instructor's records. */
  function syncActivity(payload) {
    const token = studentToken();
    if (!token) return Promise.resolve();
    return fetch("/api/student/activity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify(payload)
    })
      .then((res) => {
        if (res.status === 403) logout(); // access expired or disabled mid-session
      })
      .catch(() => {}); // offline — instructor view updates on next sync
  }

  /** Server errors arrive in Mongolian; show them in the reader's language. */
  function localizeError(message, status) {
    const I = window.I18N;
    if (!I) return message || "Алдаа гарлаа (" + status + ")";
    return message ? I.serverMessage(message) : I.t("common.errorStatus", { status });
  }

  /** Authenticated JSON GET; throws with the server's (localized) message. */
  function apiGet(path) {
    return fetch(path, { headers: { Authorization: "Bearer " + studentToken() }, cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) { logout(); return new Promise(() => {}); }
        if (!res.ok) throw new Error(localizeError(data.error, res.status));
        return data;
      });
  }

  /** Authenticated JSON POST; same error handling as apiGet. */
  function apiPost(path, payload) {
    return fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + studentToken()
      },
      body: JSON.stringify(payload || {})
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { logout(); return new Promise(() => {}); }
      if (!res.ok) throw new Error(localizeError(data.error, res.status));
      return data;
    });
  }

  function fetchServerProgress() {
    const token = studentToken();
    if (!token) return Promise.resolve(null);
    return fetch("/api/student/progress", {
      headers: { Authorization: "Bearer " + token }
    })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }

  /** Periodic heartbeat so the instructor sees who is online right now. */
  function startHeartbeat(getState) {
    const HEARTBEAT_SEC = 60;
    const send = () => {
      const state = getState ? getState() : {};
      syncActivity({
        type: "heartbeat",
        seconds: state.seconds !== undefined ? state.seconds : HEARTBEAT_SEC,
        chapterId: state.chapterId,
        questionNumber: state.questionNumber
      });
    };
    send();
    return setInterval(send, HEARTBEAT_SEC * 1000);
  }

  /* ---------- Data ---------- */

  let questionsPromise = null;

  function loadQuestions() {
    if (!questionsPromise) {
      // ?v= busts force-cached copies when the dataset changes (v2: WebP images)
      questionsPromise = fetch("/public/data/questions.json?v=3", { cache: "no-store" })
        .then((res) => {
          if (!res.ok) {
            throw new Error(window.I18N
              ? window.I18N.t("practice.dataFailed", { status: res.status })
              : "Асуултын өгөгдөл ачаалагдсангүй (" + res.status + ")");
          }
          return res.json();
        })
        .catch((err) => {
          questionsPromise = null;
          throw err;
        });
    }
    return questionsPromise;
  }

  function questionsForChapter(questions, chapterId) {
    return questions
      .filter((q) => q.chapterId === chapterId)
      .sort((a, b) => a.questionNumber - b.questionNumber);
  }

  /* ---------- Progress store ---------- */

  function defaultProgress() {
    return {
      chapters: {},
      lastChapter: null,
      lastMode: "learning",
      streak: { current: 0, best: 0, lastActiveDay: null }
    };
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultProgress();
      const data = JSON.parse(raw);
      return Object.assign(defaultProgress(), data);
    } catch (err) {
      return defaultProgress();
    }
  }

  function saveProgress(progress) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (err) {
      /* storage full or unavailable — progress becomes session-only */
    }
  }

  function chapterState(progress, chapterId) {
    const key = String(chapterId);
    if (!progress.chapters[key]) {
      progress.chapters[key] = {
        bestScore: null,
        attempts: [],
        session: null // in-progress session: { mode, index, answers: {qNum: selected} }
      };
    }
    return progress.chapters[key];
  }

  function todayString() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function touchStreak(progress) {
    const today = todayString();
    const s = progress.streak;
    if (s.lastActiveDay === today) return;
    const yesterday = new Date(Date.now() - 86400000);
    const yStr = yesterday.getFullYear() + "-" + String(yesterday.getMonth() + 1).padStart(2, "0") +
      "-" + String(yesterday.getDate()).padStart(2, "0");
    s.current = s.lastActiveDay === yStr ? s.current + 1 : 1;
    s.best = Math.max(s.best, s.current);
    s.lastActiveDay = today;
  }

  /** Effective streak for display: 0 if the user skipped a day. */
  function displayStreak(progress) {
    const s = progress.streak;
    if (!s.lastActiveDay) return 0;
    const today = todayString();
    const yesterday = new Date(Date.now() - 86400000);
    const yStr = yesterday.getFullYear() + "-" + String(yesterday.getMonth() + 1).padStart(2, "0") +
      "-" + String(yesterday.getDate()).padStart(2, "0");
    return s.lastActiveDay === today || s.lastActiveDay === yStr ? s.current : 0;
  }

  function recordAttempt(progress, chapterId, mode, score, total, durationSec) {
    const ch = chapterState(progress, chapterId);
    ch.attempts.unshift({
      mode,
      score,
      total,
      date: new Date().toISOString(),
      durationSec: Math.round(durationSec || 0)
    });
    if (ch.attempts.length > MAX_ATTEMPTS_KEPT) ch.attempts.length = MAX_ATTEMPTS_KEPT;
    ch.bestScore = ch.bestScore === null ? score : Math.max(ch.bestScore, score);
    ch.session = null;
    progress.lastChapter = chapterId;
    progress.lastMode = mode;
    touchStreak(progress);
    saveProgress(progress);
  }

  function summarize(progress) {
    let completed = 0;
    let passed = 0;
    let scoreSum = 0;
    let scored = 0;
    for (let c = 1; c <= TOTAL_CHAPTERS; c += 1) {
      const ch = progress.chapters[String(c)];
      if (ch && ch.bestScore !== null && ch.bestScore !== undefined) {
        completed += 1;
        scoreSum += ch.bestScore;
        scored += 1;
        if (ch.bestScore >= PASS_SCORE) passed += 1;
      }
    }
    return {
      completedChapters: completed,
      passedChapters: passed,
      averageScore: scored ? scoreSum / scored : null,
      completionPercent: Math.round((completed / TOTAL_CHAPTERS) * 100)
    };
  }

  window.Platform = {
    TOTAL_CHAPTERS,
    QUESTIONS_PER_CHAPTER,
    PASS_SCORE,
    requireStudent,
    studentToken,
    logout,
    syncActivity,
    fetchServerProgress,
    startHeartbeat,
    apiGet,
    apiPost,
    loadQuestions,
    questionsForChapter,
    loadProgress,
    saveProgress,
    chapterState,
    recordAttempt,
    touchStreak,
    displayStreak,
    summarize,
    getTheme,
    toggleTheme
  };
})();
