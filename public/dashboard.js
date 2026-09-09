/* Home dashboard: requires a student access-ID session, merges server-side
   progress, renders stats, streak and the chapter grid. */
(function () {
  "use strict";

  const P = window.Platform;

  /* Theme toggle */
  const themeBtn = document.getElementById("theme-toggle");
  function syncThemeIcon() {
    themeBtn.textContent = P.getTheme() === "dark" ? "☀️" : "🌙";
  }
  themeBtn.addEventListener("click", () => {
    P.toggleTheme();
    syncThemeIcon();
  });
  syncThemeIcon();

  document.getElementById("logout-btn").addEventListener("click", P.logout);

  function chapterCard(progress, chapterId) {
    const ch = progress.chapters[String(chapterId)];
    const best = ch && ch.bestScore !== null && ch.bestScore !== undefined ? ch.bestScore : null;
    const hasSession = ch && ch.session && ch.session.answers &&
      Object.keys(ch.session.answers).length > 0;

    let badgeClass = "";
    let badgeText = "Эхлээгүй";
    if (best !== null && best >= P.PASS_SCORE) {
      badgeClass = "passed";
      badgeText = "Тэнцсэн";
    } else if (best !== null) {
      badgeClass = "failed";
      badgeText = "Дахин үзэх";
    } else if (hasSession) {
      badgeClass = "progress";
      badgeText = "Үргэлжилж буй";
    }

    const percent = best !== null
      ? Math.round((best / P.QUESTIONS_PER_CHAPTER) * 100)
      : hasSession
        ? Math.round((Object.keys(ch.session.answers).length / P.QUESTIONS_PER_CHAPTER) * 100)
        : 0;

    const card = document.createElement("a");
    card.className = "chapter-card";
    card.href = "/practice?chapter=" + chapterId;
    card.setAttribute("aria-label",
      "Бүлэг " + chapterId + " — " + badgeText + (best !== null ? ", шилдэг оноо " + best + "/20" : ""));
    card.innerHTML =
      '<div class="chapter-card-top">' +
        '<span class="chapter-number">Бүлэг ' + chapterId + "</span>" +
        '<span class="chapter-badge ' + badgeClass + '">' + badgeText + "</span>" +
      "</div>" +
      '<div class="chapter-score">' +
        (best !== null ? "Шилдэг: " + best + "/20" : "20 асуулт") +
      "</div>" +
      '<div class="chapter-bar"><div class="chapter-bar-fill' +
        (best !== null && best >= P.PASS_SCORE ? " passed" : "") +
        '" style="width:' + percent + '%"></div></div>';
    return card;
  }

  function render(progress) {
    const summary = P.summarize(progress);
    document.getElementById("stat-completed").textContent = summary.completedChapters;
    document.getElementById("stat-passed").textContent = summary.passedChapters;
    document.getElementById("stat-average").textContent =
      summary.averageScore === null ? "—" : summary.averageScore.toFixed(1);
    document.getElementById("stat-streak").textContent = P.displayStreak(progress);

    const fill = document.getElementById("hero-progress-fill");
    const bar = document.getElementById("hero-progressbar");
    const label = document.getElementById("hero-progress-label");
    requestAnimationFrame(() => {
      fill.style.width = summary.completionPercent + "%";
    });
    bar.setAttribute("aria-valuenow", String(summary.completionPercent));
    label.textContent =
      summary.completedChapters === 0
        ? "Анхны бүлгээ эхлүүлээрэй — амжилт хүсье!"
        : summary.completionPercent + "% гүйцэтгэсэн · " +
          summary.completedChapters + "/" + P.TOTAL_CHAPTERS + " бүлэг";

    const continueBtn = document.getElementById("continue-btn");
    if (progress.lastChapter) {
      continueBtn.href = "/practice?chapter=" + progress.lastChapter;
      continueBtn.textContent = "Үргэлжлүүлэх — Бүлэг " + progress.lastChapter;
    }

    const grid = document.getElementById("chapter-grid");
    grid.innerHTML = "";
    for (let c = 1; c <= P.TOTAL_CHAPTERS; c += 1) {
      grid.appendChild(chapterCard(progress, c));
    }

    const recents = [];
    for (let c = 1; c <= P.TOTAL_CHAPTERS; c += 1) {
      const ch = progress.chapters[String(c)];
      if (!ch) continue;
      const lastDate = ch.attempts && ch.attempts.length ? ch.attempts[0].date : null;
      if (lastDate || (ch.session && Object.keys(ch.session.answers || {}).length)) {
        recents.push({ chapterId: c, date: lastDate || "9999" });
      }
    }
    recents.sort((a, b) => (a.date < b.date ? 1 : -1));
    if (recents.length) {
      const section = document.getElementById("recent-section");
      section.hidden = false;
      const recentGrid = document.getElementById("recent-grid");
      recentGrid.innerHTML = "";
      recents.slice(0, 4).forEach((r) => recentGrid.appendChild(chapterCard(progress, r.chapterId)));
    }
  }

  /** Shows only the areas the student has been granted. */
  function applyEntitlements(entitlements) {
    const list = Array.isArray(entitlements) ? entitlements : ["regular"];
    const hasRegular = list.indexOf("regular") !== -1;
    const hasUpgrade = list.indexOf("category_upgrade") !== -1;

    document.getElementById("category-upgrade-card").hidden = !hasUpgrade;

    if (!hasRegular) {
      // Granted only the category-upgrade exam: send them straight there
      // rather than showing a 40-chapter dashboard they cannot use.
      if (hasUpgrade) {
        location.replace("/category-upgrade");
        return false;
      }
      document.getElementById("regular-course").hidden = true;
      document.querySelector(".hero-card").hidden = true;
    }

    const nav = document.getElementById("exam-switch");
    if (hasRegular && hasUpgrade) {
      nav.innerHTML = "";
      const a = document.createElement("a");
      a.href = "/";
      a.className = "active";
      a.textContent = "Дүрмийн тест";
      const b = document.createElement("a");
      b.href = "/category-upgrade";
      b.textContent = "Ангилал ахиулах";
      nav.appendChild(a);
      nav.appendChild(b);
      nav.hidden = false;
    }
    return true;
  }

  async function init() {
    const student = await P.requireStudent();

    const chip = document.getElementById("student-chip");
    chip.textContent = student.name;
    chip.hidden = false;

    if (!applyEntitlements(student.entitlements)) return;

    const progress = P.loadProgress();
    render(progress);

    // Merge server-side records (e.g. progress made on another device).
    const server = await P.fetchServerProgress();
    if (server && server.summary && Array.isArray(server.summary.chapters)) {
      let changed = false;
      for (const ch of server.summary.chapters) {
        if (ch.bestScore === null || ch.bestScore === undefined) continue;
        const local = P.chapterState(progress, ch.chapterId);
        if (local.bestScore === null || ch.bestScore > local.bestScore) {
          local.bestScore = ch.bestScore;
          changed = true;
        }
      }
      if (server.summary.lastChapter && !progress.lastChapter) {
        progress.lastChapter = server.summary.lastChapter;
        changed = true;
      }
      if (changed) {
        P.saveProgress(progress);
        render(progress);
      }
    }

    // Presence ping so the instructor sees who is online (no study time here).
    P.startHeartbeat(() => ({ seconds: 0 }));

    P.loadQuestions().catch(() => {});
  }

  init();
})();
