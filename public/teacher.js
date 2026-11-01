/* Instructor admin panel: overview analytics, student management table,
   student profile with activity timeline and access control actions. */
(function () {
  "use strict";

  const P = window.Platform;
  const I18N = window.I18N;
  const t = I18N.t;
  I18N.boot();
  const token = localStorage.getItem("teacherToken") || "";
  if (!token) {
    location.href = "/login";
    return;
  }

  const REFRESH_MS = 60 * 1000;

  /* ---------- helpers ---------- */

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      localStorage.removeItem("teacherToken");
      location.href = "/login";
      return new Promise(() => {});
    }
    const data = await res.json();
    if (!res.ok) throw new Error(I18N.serverMessage(data.error) || t("common.error"));
    return data;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." +
      String(d.getDate()).padStart(2, "0");
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return fmtDate(iso) + " " + String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0");
  }

  function fmtRelative(iso) {
    if (!iso) return t("teacher.never");
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return t("teacher.justNow");
    if (sec < 3600) return t("teacher.minutesAgo", { n: Math.floor(sec / 60) });
    if (sec < 86400) return t("teacher.hoursAgo", { n: Math.floor(sec / 3600) });
    return t("teacher.daysAgo", { n: Math.floor(sec / 86400) });
  }

  function fmtStudyTime(sec) {
    if (!sec) return t("teacher.minutes", { m: 0 });
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? t("teacher.hoursMinutes", { h, m }) : t("teacher.minutes", { m });
  }

  function isOnline(row) {
    const t = row.lastActivityAt || row.lastLoginAt;
    return t && Date.now() - new Date(t).getTime() <= 5 * 60 * 1000;
  }

  const ENTITLEMENT_LABELS = {
    regular: t("entitlement.regular"),
    category_upgrade: t("entitlement.upgrade")
  };

  function entitlementPills(list) {
    const ids = Array.isArray(list) && list.length ? list : ["regular"];
    return ids
      .map((id) => '<span class="chapter-badge">' + esc(ENTITLEMENT_LABELS[id] || id) + "</span>")
      .join(" ");
  }

  /** Checkbox pair used both when registering and when editing a student. */
  function entitlementFields(selected) {
    const ids = Array.isArray(selected) && selected.length ? selected : ["regular"];
    return Object.keys(ENTITLEMENT_LABELS)
      .map((id) =>
        '<label style="display:flex;align-items:center;gap:8px;font-weight:600">' +
          '<input type="checkbox" name="entitlements" value="' + id + '"' +
          (ids.indexOf(id) !== -1 ? " checked" : "") + ' style="width:auto" />' +
          "<span>" + ENTITLEMENT_LABELS[id] + "</span>" +
        "</label>"
      )
      .join("");
  }

  function readEntitlements(form) {
    return Array.from(form.querySelectorAll('input[name="entitlements"]:checked')).map((i) => i.value);
  }

  function statusPill(status, online) {
    const labels = {
      active: t("teacher.statusActive"),
      expired: t("teacher.statusExpired"),
      disabled: t("teacher.statusDisabled")
    };
    return (online ? '<span class="online-dot" title="' + esc(t("teacher.online")) + '"></span>' : "") +
      '<span class="status-pill ' + status + '">' + labels[status] + "</span>";
  }

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function showError(message) {
    const area = document.getElementById("error-area");
    area.innerHTML = '<div class="error-banner">' + esc(message) + "</div>";
    setTimeout(() => { area.innerHTML = ""; }, 5000);
  }

  /* ---------- chrome ---------- */

  const themeBtn = document.getElementById("theme-toggle");
  function syncThemeIcon() { themeBtn.textContent = P.getTheme() === "dark" ? "☀️" : "🌙"; }
  themeBtn.addEventListener("click", () => { P.toggleTheme(); syncThemeIcon(); });
  syncThemeIcon();

  document.getElementById("logout-btn").addEventListener("click", () => {
    localStorage.removeItem("teacherToken");
    location.href = "/login";
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("tab-overview").hidden = btn.dataset.tab !== "overview";
      document.getElementById("tab-students").hidden = btn.dataset.tab !== "students";
    });
  });

  /* ---------- overview ---------- */

  async function loadOverview() {
    const data = await api("/api/teacher/overview");
    const s = data.stats;

    const cards = [
      ["👥", "", s.totalStudents, t("teacher.statTotal")],
      ["✅", "success", s.activeStudents, t("teacher.statActive")],
      ["⏳", "accent", s.expiredStudents, t("teacher.statExpired")],
      ["🟢", "success", s.onlineNow, t("teacher.statOnline")],
      ["📅", "", s.activeToday, t("teacher.statToday")],
      ["🗓️", "", s.activeThisWeek, t("teacher.statWeek")],
      ["📝", "", s.totalExams, t("teacher.statExams")],
      ["🎯", "accent", s.averageExamScore === null ? "—" : s.averageExamScore, t("teacher.statExamAverage")]
    ];
    document.getElementById("overview-stats").innerHTML = cards.map(([icon, tone, value, label]) =>
      '<div class="card stat-card">' +
        '<div class="stat-icon ' + tone + '">' + icon + "</div>" +
        '<div class="stat-value">' + value + "</div>" +
        '<div class="stat-label">' + label + "</div>" +
      "</div>"
    ).join("");

    const banner = document.getElementById("expiring-banner");
    if (data.expiringSoon.length) {
      banner.hidden = false;
      banner.innerHTML =
        "⚠️ <strong>" + esc(t("teacher.expiring", { count: data.expiringSoon.length })) + "</strong><ul>" +
        data.expiringSoon.slice(0, 6).map((st) =>
          "<li>" + esc(st.name) + " — " + fmtDate(st.expiresAt) + " (" + esc(st.code) + ")</li>"
        ).join("") +
        (data.expiringSoon.length > 6 ? "<li>" + esc(t("teacher.andMore")) + "</li>" : "") + "</ul>";
    } else {
      banner.hidden = true;
    }

    const days = Object.keys(data.examsPerDay);
    const max = Math.max(1, ...Object.values(data.examsPerDay));
    document.getElementById("exam-chart").innerHTML = days.map((day) => {
      const count = data.examsPerDay[day];
      const pct = Math.round((count / max) * 100);
      return '<div class="chart-bar" title="' + esc(t("teacher.chartBar", { day, count })) + '" style="height:' +
        Math.max(pct, 3) + '%">' + (count ? '<div class="bar-fill"></div>' : "") + "</div>";
    }).join("");
    document.getElementById("exam-chart-labels").innerHTML =
      days.map((day) => "<span>" + day.slice(8) + "</span>").join("");

    document.getElementById("most-active").innerHTML = data.mostActive.length
      ? data.mostActive.map((row, i) =>
          '<div class="ranked-item">' +
            '<span class="ranked-num">' + (i + 1) + "</span>" +
            '<span class="ri-name">' + esc(row.name) + "</span>" +
            '<span class="ri-meta">' +
              esc(t("teacher.activeMeta", { time: fmtStudyTime(row.studyTimeSec), count: row.examCount })) + "</span>" +
          "</div>"
        ).join("")
      : '<div class="empty-state" style="padding:20px">' + esc(t("teacher.noActivity")) + "</div>";
  }

  /* ---------- students list ---------- */

  const state = { students: [], search: "", status: "all", sort: "createdAt" };

  const sorters = {
    createdAt: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    name: (a, b) => a.name.localeCompare(b.name),
    expiresAt: (a, b) => new Date(a.expiresAt) - new Date(b.expiresAt),
    lastActive: (a, b) =>
      new Date(b.lastActivityAt || b.lastLoginAt || 0) - new Date(a.lastActivityAt || a.lastLoginAt || 0),
    progress: (a, b) => b.progressPercent - a.progressPercent,
    score: (a, b) => (b.averageScore || 0) - (a.averageScore || 0)
  };

  function visibleStudents() {
    const q = state.search.toLowerCase();
    return state.students
      .filter((row) => state.status === "all" || row.status === state.status)
      .filter((row) =>
        !q ||
        row.name.toLowerCase().includes(q) ||
        (row.phone || "").toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q))
      .sort(sorters[state.sort] || sorters.createdAt);
  }

  function renderStudents() {
    const rows = visibleStudents();
    const tbody = document.getElementById("students-tbody");
    document.getElementById("students-empty").hidden = rows.length > 0;

    tbody.innerHTML = rows.map((row) =>
      '<tr data-id="' + row.id + '">' +
        '<td><div class="cell-name">' + esc(row.name) + '</div>' +
          '<div class="cell-sub">' + esc(row.phone || t("teacher.noPhone")) + "</div></td>" +
        '<td><span class="code-pill">' + esc(row.code) + "</span>" +
          '<div class="cell-sub">' + entitlementPills(row.entitlements) + "</div></td>" +
        "<td>" + statusPill(row.status, isOnline(row)) + "</td>" +
        "<td>" + fmtDate(row.createdAt) + "</td>" +
        "<td>" + fmtDate(row.expiresAt) + "</td>" +
        "<td>" + fmtRelative(row.lastActivityAt || row.lastLoginAt) + "</td>" +
        "<td><strong>" + row.progressPercent + "%</strong> <span class='cell-sub'>(" +
          row.chaptersStarted + "/40)</span></td>" +
        "<td>" + (row.averageScore === null ? "—" : "<strong>" + row.averageScore + "</strong>/20") + "</td>" +
        '<td><div class="row-actions">' +
          '<button class="mini-btn" data-action="view" type="button">' + esc(t("teacher.view")) + "</button>" +
          '<button class="mini-btn" data-action="extend" type="button">' + esc(t("teacher.extendDays", { days: 30 })) + "</button>" +
          (row.status === "disabled"
            ? '<button class="mini-btn" data-action="enable" type="button">' + esc(t("teacher.enable")) + "</button>"
            : '<button class="mini-btn danger" data-action="disable" type="button">' + esc(t("teacher.disable")) + "</button>") +
          '<button class="mini-btn danger" data-action="delete" type="button">' + esc(t("teacher.delete")) + "</button>" +
        "</div></td>" +
      "</tr>"
    ).join("");
  }

  async function loadStudents() {
    const data = await api("/api/teacher/students");
    state.students = data.students;
    renderStudents();
  }

  document.getElementById("search-input").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    renderStudents();
  });
  document.getElementById("status-filter").addEventListener("change", (e) => {
    state.status = e.target.value;
    renderStudents();
  });
  document.getElementById("sort-select").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderStudents();
  });
  document.querySelectorAll(".students-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      state.sort = th.dataset.sort;
      document.getElementById("sort-select").value = state.sort;
      renderStudents();
    });
  });

  /* row actions */
  document.getElementById("students-tbody").addEventListener("click", async (event) => {
    const tr = event.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;
    const action = event.target.dataset.action;

    try {
      if (!action || action === "view") {
        openProfile(id);
      } else if (action === "extend") {
        await api("/api/teacher/students/" + id + "/extend", {
          method: "POST",
          body: JSON.stringify({ days: 30 })
        });
        toast(t("teacher.toastExtended", { days: 30 }));
        await loadStudents();
      } else if (action === "disable") {
        if (!confirm(t("teacher.confirmDisable"))) return;
        await api("/api/teacher/students/" + id + "/revoke", { method: "POST" });
        toast(t("teacher.toastDisabled"));
        await loadStudents();
      } else if (action === "enable") {
        await api("/api/teacher/students/" + id + "/enable", { method: "POST" });
        toast(t("teacher.toastEnabled"));
        await loadStudents();
      } else if (action === "delete") {
        if (!confirm(t("teacher.confirmDelete"))) return;
        await api("/api/teacher/students/" + id, { method: "DELETE" });
        toast(t("teacher.toastDeleted"));
        await loadStudents();
      }
    } catch (error) {
      showError(error.message);
    }
  });

  /* ---------- create student ---------- */

  const createCard = document.getElementById("create-card");
  document.getElementById("new-student-btn").addEventListener("click", () => {
    createCard.hidden = !createCard.hidden;
    document.getElementById("new-id-reveal").hidden = true;
    if (!createCard.hidden) createCard.querySelector("input").focus();
  });
  document.getElementById("create-cancel").addEventListener("click", () => {
    createCard.hidden = true;
  });

  document.getElementById("create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const fd = new FormData(form);
    try {
      const data = await api("/api/teacher/students", {
        method: "POST",
        body: JSON.stringify({
          name: String(fd.get("name") || "").trim(),
          phone: String(fd.get("phone") || "").trim(),
          notes: String(fd.get("notes") || "").trim(),
          durationDays: parseInt(fd.get("durationDays"), 10) || 30,
          entitlements: readEntitlements(form)
        })
      });
      form.reset();
      const reveal = document.getElementById("new-id-reveal");
      reveal.hidden = false;
      document.getElementById("new-id-code").textContent = data.student.code;
      toast(t("teacher.toastRegistered", { name: data.student.name }));
      await loadStudents();
    } catch (error) {
      showError(error.message);
    }
  });

  document.getElementById("copy-id-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(document.getElementById("new-id-code").textContent)
      .then(() => toast(t("teacher.toastCopied")));
  });

  /* ---------- student profile ---------- */

  const listView = document.getElementById("students-list-view");
  const profileView = document.getElementById("student-profile-view");

  async function openProfile(id) {
    document.querySelector('.tab-btn[data-tab="students"]').click();
    listView.hidden = true;
    profileView.hidden = false;
    profileView.innerHTML = '<div class="skeleton-card" style="min-height:300px"></div>';

    try {
      const { student } = await api("/api/teacher/students/" + encodeURIComponent(id));
      renderProfile(student);
    } catch (error) {
      profileView.innerHTML = '<div class="error-banner">' + esc(error.message) + "</div>";
    }
  }

  function closeProfile() {
    profileView.hidden = true;
    listView.hidden = false;
    loadStudents().catch(() => {});
  }

  function statCard(icon, tone, value, label) {
    return '<div class="card stat-card">' +
      '<div class="stat-icon ' + tone + '">' + icon + "</div>" +
      '<div class="stat-value">' + value + "</div>" +
      '<div class="stat-label">' + label + "</div></div>";
  }

  function renderProfile(st) {
    const sum = st.summary;
    const initials = st.name.trim().slice(0, 1).toUpperCase();
    const heat = [];
    const byChapter = {};
    for (const ch of sum.chapters) byChapter[ch.chapterId] = ch;
    for (let c = 1; c <= 40; c += 1) {
      const ch = byChapter[c];
      const cls = !ch || ch.bestScore === null ? "" : ch.bestScore >= 18 ? "pass" : "fail";
      const title = ch && ch.bestScore !== null
        ? t("teacher.heatBest", { chapter: c, score: ch.bestScore, attempts: ch.attempts })
        : t("teacher.heatNone", { chapter: c });
      heat.push('<div class="heat-cell ' + cls + '" title="' + esc(title) + '">' + c + "</div>");
    }

    profileView.innerHTML =
      '<div class="profile-header">' +
        '<button class="icon-btn" id="profile-back" type="button" aria-label="' + esc(t("common.back")) + '">←</button>' +
        '<div class="avatar">' + esc(initials) + "</div>" +
        "<div><h2>" + esc(st.name) + "</h2>" +
          '<div class="sub">' + esc(st.phone || t("teacher.noPhone")) + " · " +
            esc(t("teacher.registeredOn", { date: fmtDate(st.createdAt) })) + "</div></div>" +
        "<div style='margin-left:auto'>" + statusPill(st.status, st.onlineNow) + "</div>" +
      "</div>" +

      '<div class="admin-stats-grid">' +
        statCard("📈", "", sum.progressPercent + "%", t("teacher.pProgress", { count: sum.chaptersStarted })) +
        statCard("🎯", "", sum.averageScore === null ? "—" : sum.averageScore, t("teacher.pAverage")) +
        statCard("🏆", "success", sum.highestScore === null ? "—" : sum.highestScore, t("teacher.pHighest")) +
        statCard("📝", "", sum.examCount, t("teacher.pExams")) +
        statCard("✅", "success", sum.examPassRate === null ? "—" : sum.examPassRate + "%", t("teacher.pPassRate")) +
        statCard("⏱️", "accent", fmtStudyTime(sum.studyTimeSec), t("teacher.pStudyTime")) +
        statCard("🕐", "", fmtRelative(st.lastActivityAt || st.lastLoginAt), t("teacher.pLastActive")) +
        statCard("📖", "", sum.lastChapter ? t("chapter.name", { chapter: sum.lastChapter }) : "—",
          sum.currentQuestion ? t("teacher.pCurrentQuestion", { n: sum.currentQuestion }) : t("teacher.pLastChapter")) +
        ((st.entitlements || []).indexOf("category_upgrade") !== -1 && st.categoryUpgrade
          ? statCard("🚚", "", st.categoryUpgrade.testsPassed + "/" + st.categoryUpgrade.totalTests,
              t("teacher.pUpgradePassed")) +
            statCard("🎯", "",
              st.categoryUpgrade.averageScore === null ? "—" : st.categoryUpgrade.averageScore,
              t("teacher.pUpgradeAverage", { per: st.categoryUpgrade.questionsPerTest }))
          : "") +
      "</div>" +

      '<div class="profile-grid">' +
        '<div class="card">' +
          '<h3 style="margin:0 0 12px">' + esc(t("teacher.personal")) + "</h3>" +
          '<dl class="kv-list">' +
            "<dt>" + esc(t("teacher.colCode")) + "</dt><dd><span class='code-pill'>" + esc(st.code) +
              "</span> <button class='mini-btn' id='copy-profile-id' type='button'>📋</button></dd>" +
            "<dt>" + esc(t("teacher.fieldPhone")) + "</dt><dd>" + esc(st.phone || "—") + "</dd>" +
            "<dt>" + esc(t("teacher.colCreated")) + "</dt><dd>" + fmtDate(st.createdAt) + "</dd>" +
            "<dt>" + esc(t("teacher.colExpires")) + "</dt><dd>" + fmtDate(st.expiresAt) + "</dd>" +
            "<dt>" + esc(t("teacher.fieldLastLogin")) + "</dt><dd>" + fmtDateTime(st.lastLoginAt) + "</dd>" +
            "<dt>" + esc(t("teacher.fieldEntitlements")) + "</dt><dd>" + entitlementPills(st.entitlements) + "</dd>" +
            "<dt>" + esc(t("teacher.fieldNotes")) + "</dt><dd>" + esc(st.notes || "—") + "</dd>" +
          "</dl>" +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">' +
            [30, 60, 90].map((days) =>
              '<button class="btn btn-soft" data-extend="' + days + '" type="button">' +
                esc(t("teacher.extendDays", { days })) + "</button>").join("") +
            '<button class="btn btn-ghost" id="profile-edit-btn" type="button">' + esc(t("teacher.edit")) + "</button>" +
            (st.status === "disabled"
              ? '<button class="btn btn-ghost" id="profile-enable" type="button">' + esc(t("teacher.enableAccess")) + "</button>"
              : '<button class="btn btn-ghost" id="profile-disable" type="button">' + esc(t("teacher.disableAccess")) + "</button>") +
          "</div>" +
          '<form id="profile-edit-form" class="form-grid" style="margin-top:16px" hidden>' +
            "<label><span>" + esc(t("teacher.fieldName")) + '</span><input name="name" value="' + esc(st.name) + '" minlength="2" required /></label>' +
            "<label><span>" + esc(t("teacher.fieldPhone")) + '</span><input name="phone" value="' + esc(st.phone) + '" /></label>' +
            '<label class="full"><span>' + esc(t("teacher.fieldNotes")) + '</span><input name="notes" value="' + esc(st.notes) + '" /></label>' +
            '<div class="full"><span style="display:block;font-size:12px;font-weight:700;' +
              'color:var(--text-muted);margin-bottom:8px">' + esc(t("teacher.fieldEntitlements")) + "</span>" +
              '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
                entitlementFields(st.entitlements) +
              "</div></div>" +
            '<div class="full"><button class="btn btn-primary" type="submit">' + esc(t("teacher.save")) + "</button></div>" +
          "</form>" +
          (st.extensions && st.extensions.length
            ? '<h4 style="margin:18px 0 6px">' + esc(t("teacher.extensions")) + '</h4><ul class="timeline">' +
              st.extensions.slice().reverse().map((ext) =>
                "<li><span class='tl-time'>" + fmtDateTime(ext.createdAt) + "</span>" +
                fmtDate(ext.from) + " → " + fmtDate(ext.to) +
                (ext.days ? esc(t("teacher.extensionDays", { days: ext.days })) : "") + "</li>"
              ).join("") + "</ul>"
            : "") +
        "</div>" +

        '<div class="card">' +
          '<h3 style="margin:0 0 4px">' + esc(t("teacher.heatmap")) + "</h3>" +
          '<p class="section-hint" style="margin:0">' + esc(t("teacher.heatLegend")) + "</p>" +
          '<div class="chapter-heatmap">' + heat.join("") + "</div>" +
          (sum.weakestChapters.length
            ? '<h4 style="margin:16px 0 0">' + esc(t("teacher.weak")) + '</h4><div class="chips">' +
              sum.weakestChapters.map((ch) =>
                '<span class="chip weak">' + esc(t("chapter.name", { chapter: ch.chapterId })) + " · " +
                  ch.bestScore + "/20</span>").join("") +
              '</div><h4 style="margin:14px 0 0">' + esc(t("teacher.strong")) + '</h4><div class="chips">' +
              sum.strongestChapters.map((ch) =>
                '<span class="chip good">' + esc(t("chapter.name", { chapter: ch.chapterId })) + " · " +
                  ch.bestScore + "/20</span>").join("") +
              "</div>"
            : "") +
        "</div>" +

        '<div class="card">' +
          '<h3 style="margin:0 0 6px">' + esc(t("teacher.history")) + "</h3>" +
          (st.examResults.length
            ? '<table class="history-table"><thead><tr>' +
                ["teacher.colDate", "teacher.colChapter", "teacher.colScore", "teacher.colResult", "teacher.colDuration"]
                  .map((key) => "<th>" + esc(t(key)) + "</th>").join("") +
              "</tr></thead><tbody>" +
              st.examResults.map((exam) =>
                "<tr><td>" + fmtDateTime(exam.date) + "</td><td>" +
                  esc(t("chapter.name", { chapter: exam.chapterId })) + "</td>" +
                "<td><strong>" + exam.score + "</strong>/" + exam.total + "</td>" +
                "<td>" + (exam.score >= 18
                  ? '<span class="status-pill active">' + esc(t("teacher.resultPassed")) + "</span>"
                  : '<span class="status-pill expired">' + esc(t("teacher.resultFailed")) + "</span>") + "</td>" +
                "<td>" + fmtStudyTime(exam.durationSec) + "</td></tr>"
              ).join("") + "</tbody></table>"
            : '<div class="empty-state" style="padding:18px">' + esc(t("teacher.noExams")) + "</div>") +
        "</div>" +

        '<div class="card">' +
          '<h3 style="margin:0 0 6px">' + esc(t("teacher.timeline")) + "</h3>" +
          (st.activityTimeline.length
            ? '<ul class="timeline">' +
              st.activityTimeline.map((item) =>
                "<li><span class='tl-time'>" + fmtDateTime(item.createdAt) + "</span>" +
                esc(I18N.activity(item.summary)) + "</li>").join("") + "</ul>"
            : '<div class="empty-state" style="padding:18px">' + esc(t("teacher.noTimeline")) + "</div>") +
        "</div>" +
      "</div>";

    /* profile event wiring */
    document.getElementById("profile-back").addEventListener("click", closeProfile);
    document.getElementById("copy-profile-id").addEventListener("click", () => {
      navigator.clipboard.writeText(st.code).then(() => toast(t("teacher.toastCopied")));
    });
    profileView.querySelectorAll("[data-extend]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("/api/teacher/students/" + st.id + "/extend", {
            method: "POST",
            body: JSON.stringify({ days: Number(btn.dataset.extend) })
          });
          toast(t("teacher.toastExtended", { days: btn.dataset.extend }));
          openProfile(st.id);
        } catch (error) { showError(error.message); }
      });
    });
    const editBtn = document.getElementById("profile-edit-btn");
    const editForm = document.getElementById("profile-edit-form");
    editBtn.addEventListener("click", () => { editForm.hidden = !editForm.hidden; });
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(editForm);
      try {
        await api("/api/teacher/students/" + st.id, {
          method: "PATCH",
          body: JSON.stringify({
            name: String(fd.get("name") || "").trim(),
            phone: String(fd.get("phone") || "").trim(),
            notes: String(fd.get("notes") || "").trim(),
            entitlements: readEntitlements(editForm)
          })
        });
        toast(t("teacher.toastSaved"));
        openProfile(st.id);
      } catch (error) { showError(error.message); }
    });
    const disableBtn = document.getElementById("profile-disable");
    if (disableBtn) {
      disableBtn.addEventListener("click", async () => {
        if (!confirm(t("teacher.confirmDisable"))) return;
        try {
          await api("/api/teacher/students/" + st.id + "/revoke", { method: "POST" });
          toast(t("teacher.toastDisabled"));
          openProfile(st.id);
        } catch (error) { showError(error.message); }
      });
    }
    const enableBtn = document.getElementById("profile-enable");
    if (enableBtn) {
      enableBtn.addEventListener("click", async () => {
        try {
          await api("/api/teacher/students/" + st.id + "/enable", { method: "POST" });
          toast(t("teacher.toastEnabled"));
          openProfile(st.id);
        } catch (error) { showError(error.message); }
      });
    }
  }

  /* ---------- boot + live refresh ---------- */

  function refresh() {
    loadOverview().catch((err) => showError(err.message));
    loadStudents().catch((err) => showError(err.message));
  }

  refresh();
  setInterval(() => {
    // Keep "online now" fresh; skip while a profile is open so it doesn't blink.
    if (profileView.hidden) refresh();
  }, REFRESH_MS);
})();
