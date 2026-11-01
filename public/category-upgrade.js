/* "Ангилал ахиулах" catalog: lists the 20 tests and the student's progress.
   All data comes from the authenticated API, so a student without the
   entitlement is turned away by the server, not just by a hidden link. */
(function () {
  "use strict";

  const P = window.Platform;
  const I18N = window.I18N;
  const t = I18N.t;
  I18N.boot();

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

  function showError(message) {
    const area = document.getElementById("error-area");
    area.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "error-banner";
    banner.textContent = message;
    area.appendChild(banner);
  }

  function testCard(test, passScore) {
    const best = test.bestScore === null || test.bestScore === undefined ? null : test.bestScore;

    let badgeClass = "";
    let badgeText = t("badge.notStarted");
    if (best !== null && best >= passScore) {
      badgeClass = "passed";
      badgeText = t("badge.passed");
    } else if (best !== null) {
      badgeClass = "failed";
      badgeText = t("badge.retry");
    }

    const percent = best !== null ? Math.round((best / test.questionCount) * 100) : 0;

    const card = document.createElement("a");
    card.className = "chapter-card";
    card.href = "/category-upgrade/practice?test=" + test.testNumber;
    const name = t("test.name", { test: test.testNumber });
    card.setAttribute("aria-label", best !== null
      ? t("card.ariaBest", { name, status: badgeText, score: best, total: test.questionCount })
      : t("card.aria", { name, status: badgeText }));
    card.innerHTML =
      '<div class="chapter-card-top">' +
        '<span class="chapter-number">' + name + "</span>" +
        '<span class="chapter-badge ' + badgeClass + '">' + badgeText + "</span>" +
      "</div>" +
      '<div class="chapter-score">' +
        (best !== null
          ? t("card.best", { score: best, total: test.questionCount })
          : t("card.questions", { count: test.questionCount })) +
      "</div>" +
      '<div class="chapter-bar"><div class="chapter-bar-fill' +
        (best !== null && best >= passScore ? " passed" : "") +
        '" style="width:' + percent + '%"></div></div>';
    return card;
  }

  function renderSwitch(entitlements) {
    const nav = document.getElementById("exam-switch");
    nav.innerHTML = "";
    if (entitlements.indexOf("regular") !== -1) {
      const a = document.createElement("a");
      a.href = "/";
      a.textContent = t("entitlement.regular");
      nav.appendChild(a);
    }
    const b = document.createElement("a");
    b.href = "/category-upgrade";
    b.className = "active";
    b.textContent = t("entitlement.upgrade");
    nav.appendChild(b);
    nav.hidden = nav.childElementCount < 2;
  }

  function render(data) {
    document.getElementById("hero-sub").textContent =
      t("upgrade.sub", { tests: data.totalTests, per: data.questionsPerTest });
    document.getElementById("stat-started").textContent = data.summary.testsStarted;
    document.getElementById("stat-started-label").textContent =
      t("upgrade.statStartedOf", { total: data.totalTests });
    document.getElementById("stat-passed").textContent = data.summary.testsPassed;
    document.getElementById("stat-passed-label").textContent =
      t("upgrade.statPassedPass", { pass: data.passScore });
    document.getElementById("stat-average").textContent =
      data.summary.averageScore === null ? "—" : data.summary.averageScore.toFixed(1);
    document.getElementById("stat-attempts").textContent = data.summary.attemptCount;

    const percent = data.totalTests
      ? Math.round((data.summary.testsStarted / data.totalTests) * 100)
      : 0;
    const fill = document.getElementById("hero-progress-fill");
    requestAnimationFrame(() => { fill.style.width = percent + "%"; });
    document.getElementById("hero-progressbar").setAttribute("aria-valuenow", String(percent));
    document.getElementById("hero-progress-label").textContent =
      data.summary.testsStarted === 0
        ? t("upgrade.firstTest")
        : t("upgrade.progressDone", { percent, done: data.summary.testsStarted, total: data.totalTests });

    const continueBtn = document.getElementById("continue-btn");
    if (data.summary.lastTest) {
      continueBtn.href = "/category-upgrade/practice?test=" + data.summary.lastTest;
      continueBtn.textContent = t("upgrade.continue", { test: data.summary.lastTest });
    }

    const grid = document.getElementById("test-grid");
    grid.innerHTML = "";
    data.tests.forEach((t) => grid.appendChild(testCard(t, data.passScore)));
  }

  async function init() {
    const student = await P.requireStudent();

    const chip = document.getElementById("student-chip");
    chip.textContent = student.name;
    chip.hidden = false;
    renderSwitch(student.entitlements || []);

    if ((student.entitlements || []).indexOf("category_upgrade") === -1) {
      document.getElementById("test-grid").innerHTML = "";
      showError(t("server.noUpgrade"));
      return;
    }

    try {
      const data = await P.apiGet("/api/category-upgrade/catalog");
      render(data);
    } catch (error) {
      document.getElementById("test-grid").innerHTML = "";
      showError(error.message);
    }

    P.startHeartbeat(() => ({ seconds: 0 }));
  }

  init();
})();
