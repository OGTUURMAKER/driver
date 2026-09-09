/* Instructor admin panel: overview analytics, student management table,
   student profile with activity timeline and access control actions. */
(function () {
  "use strict";

  const P = window.Platform;
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
    if (!res.ok) throw new Error(data.error || "Алдаа гарлаа.");
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
    if (!iso) return "Хэзээ ч";
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return "Дөнгөж сая";
    if (sec < 3600) return Math.floor(sec / 60) + " мин өмнө";
    if (sec < 86400) return Math.floor(sec / 3600) + " цаг өмнө";
    return Math.floor(sec / 86400) + " хоног өмнө";
  }

  function fmtStudyTime(sec) {
    if (!sec) return "0 мин";
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? h + " цаг " + m + " мин" : m + " мин";
  }

  function isOnline(row) {
    const t = row.lastActivityAt || row.lastLoginAt;
    return t && Date.now() - new Date(t).getTime() <= 5 * 60 * 1000;
  }

  const ENTITLEMENT_LABELS = {
    regular: "Дүрмийн тест",
    category_upgrade: "Ангилал ахиулах"
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
    const labels = { active: "Идэвхтэй", expired: "Хугацаа дууссан", disabled: "Хаагдсан" };
    return (online ? '<span class="online-dot" title="Онлайн"></span>' : "") +
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
      ["👥", "", s.totalStudents, "Нийт сурагч"],
      ["✅", "success", s.activeStudents, "Идэвхтэй эрхтэй"],
      ["⏳", "accent", s.expiredStudents, "Хугацаа дууссан"],
      ["🟢", "success", s.onlineNow, "Яг одоо онлайн"],
      ["📅", "", s.activeToday, "Өнөөдөр идэвхтэй"],
      ["🗓️", "", s.activeThisWeek, "Энэ 7 хоногт идэвхтэй"],
      ["📝", "", s.totalExams, "Нийт шалгалт өгсөн"],
      ["🎯", "accent", s.averageExamScore === null ? "—" : s.averageExamScore, "Шалгалтын дундаж / 20"]
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
        "⚠️ <strong>" + data.expiringSoon.length +
        " сурагчийн эрх 7 хоногийн дотор дуусна:</strong><ul>" +
        data.expiringSoon.slice(0, 6).map((st) =>
          "<li>" + esc(st.name) + " — " + fmtDate(st.expiresAt) + " (" + esc(st.code) + ")</li>"
        ).join("") +
        (data.expiringSoon.length > 6 ? "<li>… болон бусад</li>" : "") + "</ul>";
    } else {
      banner.hidden = true;
    }

    const days = Object.keys(data.examsPerDay);
    const max = Math.max(1, ...Object.values(data.examsPerDay));
    document.getElementById("exam-chart").innerHTML = days.map((day) => {
      const count = data.examsPerDay[day];
      const pct = Math.round((count / max) * 100);
      return '<div class="chart-bar" title="' + day + ": " + count + ' шалгалт" style="height:' +
        Math.max(pct, 3) + '%">' + (count ? '<div class="bar-fill"></div>' : "") + "</div>";
    }).join("");
    document.getElementById("exam-chart-labels").innerHTML =
      days.map((day) => "<span>" + day.slice(8) + "</span>").join("");

    document.getElementById("most-active").innerHTML = data.mostActive.length
      ? data.mostActive.map((row, i) =>
          '<div class="ranked-item">' +
            '<span class="ranked-num">' + (i + 1) + "</span>" +
            '<span class="ri-name">' + esc(row.name) + "</span>" +
            '<span class="ri-meta">' + fmtStudyTime(row.studyTimeSec) + " · " +
              row.examCount + " шалгалт</span>" +
          "</div>"
        ).join("")
      : '<div class="empty-state" style="padding:20px">Идэвх бүртгэгдээгүй байна.</div>';
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
          '<div class="cell-sub">' + esc(row.phone || "Утас бүртгээгүй") + "</div></td>" +
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
          '<button class="mini-btn" data-action="view" type="button">Үзэх</button>' +
          '<button class="mini-btn" data-action="extend" type="button">+30 хоног</button>' +
          (row.status === "disabled"
            ? '<button class="mini-btn" data-action="enable" type="button">Нээх</button>'
            : '<button class="mini-btn danger" data-action="disable" type="button">Хаах</button>') +
          '<button class="mini-btn danger" data-action="delete" type="button">Устгах</button>' +
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
        toast("Эрхийг 30 хоногоор сунгалаа");
        await loadStudents();
      } else if (action === "disable") {
        if (!confirm("Энэ сурагчийн хандах эрхийг түр хаах уу?")) return;
        await api("/api/teacher/students/" + id + "/revoke", { method: "POST" });
        toast("Хандах эрхийг хаалаа");
        await loadStudents();
      } else if (action === "enable") {
        await api("/api/teacher/students/" + id + "/enable", { method: "POST" });
        toast("Хандах эрхийг нээлээ");
        await loadStudents();
      } else if (action === "delete") {
        if (!confirm("Энэ сурагчийг бүх түүхтэй нь хамт устгах уу? Энэ үйлдлийг буцаах боломжгүй.")) return;
        await api("/api/teacher/students/" + id, { method: "DELETE" });
        toast("Сурагчийг устгалаа");
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
      toast(data.student.name + " бүртгэгдлээ");
      await loadStudents();
    } catch (error) {
      showError(error.message);
    }
  });

  document.getElementById("copy-id-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(document.getElementById("new-id-code").textContent)
      .then(() => toast("ID хуулагдлаа"));
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
        ? "Бүлэг " + c + ": шилдэг " + ch.bestScore + "/20, " + ch.attempts + " оролдлого"
        : "Бүлэг " + c + ": эхлээгүй";
      heat.push('<div class="heat-cell ' + cls + '" title="' + title + '">' + c + "</div>");
    }

    profileView.innerHTML =
      '<div class="profile-header">' +
        '<button class="icon-btn" id="profile-back" type="button" aria-label="Буцах">←</button>' +
        '<div class="avatar">' + esc(initials) + "</div>" +
        "<div><h2>" + esc(st.name) + "</h2>" +
          '<div class="sub">' + esc(st.phone || "Утас бүртгээгүй") + " · Бүртгэсэн " + fmtDate(st.createdAt) + "</div></div>" +
        "<div style='margin-left:auto'>" + statusPill(st.status, st.onlineNow) + "</div>" +
      "</div>" +

      '<div class="admin-stats-grid">' +
        statCard("📈", "", sum.progressPercent + "%", "Явц (" + sum.chaptersStarted + "/40 бүлэг)") +
        statCard("🎯", "", sum.averageScore === null ? "—" : sum.averageScore, "Дундаж оноо / 20") +
        statCard("🏆", "success", sum.highestScore === null ? "—" : sum.highestScore, "Хамгийн өндөр оноо") +
        statCard("📝", "", sum.examCount, "Шалгалт өгсөн") +
        statCard("✅", "success", sum.examPassRate === null ? "—" : sum.examPassRate + "%", "Шалгалт тэнцсэн хувь") +
        statCard("⏱️", "accent", fmtStudyTime(sum.studyTimeSec), "Нийт суралцсан хугацаа") +
        statCard("🕐", "", fmtRelative(st.lastActivityAt || st.lastLoginAt), "Сүүлд идэвхтэй") +
        statCard("📖", "", sum.lastChapter ? "Бүлэг " + sum.lastChapter : "—",
          sum.currentQuestion ? "Одоо: асуулт " + sum.currentQuestion : "Сүүлийн бүлэг") +
        ((st.entitlements || []).indexOf("category_upgrade") !== -1 && st.categoryUpgrade
          ? statCard("🚚", "", st.categoryUpgrade.testsPassed + "/" + st.categoryUpgrade.totalTests,
              "Ангилал ахиулах — тэнцсэн") +
            statCard("🎯", "",
              st.categoryUpgrade.averageScore === null ? "—" : st.categoryUpgrade.averageScore,
              "Ангилал ахиулах — дундаж / " + st.categoryUpgrade.questionsPerTest)
          : "") +
      "</div>" +

      '<div class="profile-grid">' +
        '<div class="card">' +
          '<h3 style="margin:0 0 12px">Хувийн мэдээлэл</h3>' +
          '<dl class="kv-list">' +
            "<dt>Access ID</dt><dd><span class='code-pill'>" + esc(st.code) +
              "</span> <button class='mini-btn' id='copy-profile-id' type='button'>📋</button></dd>" +
            "<dt>Утас</dt><dd>" + esc(st.phone || "—") + "</dd>" +
            "<dt>Бүртгэсэн</dt><dd>" + fmtDate(st.createdAt) + "</dd>" +
            "<dt>Дуусах</dt><dd>" + fmtDate(st.expiresAt) + "</dd>" +
            "<dt>Сүүлд нэвтэрсэн</dt><dd>" + fmtDateTime(st.lastLoginAt) + "</dd>" +
            "<dt>Шалгалтын эрх</dt><dd>" + entitlementPills(st.entitlements) + "</dd>" +
            "<dt>Тэмдэглэл</dt><dd>" + esc(st.notes || "—") + "</dd>" +
          "</dl>" +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">' +
            '<button class="btn btn-soft" data-extend="30" type="button">+30 хоног</button>' +
            '<button class="btn btn-soft" data-extend="60" type="button">+60 хоног</button>' +
            '<button class="btn btn-soft" data-extend="90" type="button">+90 хоног</button>' +
            '<button class="btn btn-ghost" id="profile-edit-btn" type="button">✏️ Засах</button>' +
            (st.status === "disabled"
              ? '<button class="btn btn-ghost" id="profile-enable" type="button">Эрх нээх</button>'
              : '<button class="btn btn-ghost" id="profile-disable" type="button">Эрх хаах</button>') +
          "</div>" +
          '<form id="profile-edit-form" class="form-grid" style="margin-top:16px" hidden>' +
            '<label><span>Нэр</span><input name="name" value="' + esc(st.name) + '" minlength="2" required /></label>' +
            '<label><span>Утас</span><input name="phone" value="' + esc(st.phone) + '" /></label>' +
            '<label class="full"><span>Тэмдэглэл</span><input name="notes" value="' + esc(st.notes) + '" /></label>' +
            '<div class="full"><span style="display:block;font-size:12px;font-weight:700;' +
              'color:var(--text-muted);margin-bottom:8px">Шалгалтын эрх</span>' +
              '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
                entitlementFields(st.entitlements) +
              "</div></div>" +
            '<div class="full"><button class="btn btn-primary" type="submit">Хадгалах</button></div>' +
          "</form>" +
          (st.extensions && st.extensions.length
            ? '<h4 style="margin:18px 0 6px">Сунгалтын түүх</h4><ul class="timeline">' +
              st.extensions.slice().reverse().map((ext) =>
                "<li><span class='tl-time'>" + fmtDateTime(ext.createdAt) + "</span>" +
                fmtDate(ext.from) + " → " + fmtDate(ext.to) +
                (ext.days ? " (+" + ext.days + " хоног)" : "") + "</li>"
              ).join("") + "</ul>"
            : "") +
        "</div>" +

        '<div class="card">' +
          '<h3 style="margin:0 0 4px">Бүлгийн зураглал</h3>' +
          '<p class="section-hint" style="margin:0">Ногоон = тэнцсэн (18+), улаан = дахин үзэх</p>' +
          '<div class="chapter-heatmap">' + heat.join("") + "</div>" +
          (sum.weakestChapters.length
            ? '<h4 style="margin:16px 0 0">Сул бүлгүүд</h4><div class="chips">' +
              sum.weakestChapters.map((ch) =>
                '<span class="chip weak">Бүлэг ' + ch.chapterId + " · " + ch.bestScore + "/20</span>").join("") +
              '</div><h4 style="margin:14px 0 0">Сайн бүлгүүд</h4><div class="chips">' +
              sum.strongestChapters.map((ch) =>
                '<span class="chip good">Бүлэг ' + ch.chapterId + " · " + ch.bestScore + "/20</span>").join("") +
              "</div>"
            : "") +
        "</div>" +

        '<div class="card">' +
          '<h3 style="margin:0 0 6px">Шалгалтын түүх</h3>' +
          (st.examResults.length
            ? '<table class="history-table"><thead><tr><th>Огноо</th><th>Бүлэг</th><th>Оноо</th><th>Үр дүн</th><th>Хугацаа</th></tr></thead><tbody>' +
              st.examResults.map((exam) =>
                "<tr><td>" + fmtDateTime(exam.date) + "</td><td>Бүлэг " + exam.chapterId + "</td>" +
                "<td><strong>" + exam.score + "</strong>/" + exam.total + "</td>" +
                "<td>" + (exam.score >= 18
                  ? '<span class="status-pill active">Тэнцсэн</span>'
                  : '<span class="status-pill expired">Тэнцээгүй</span>') + "</td>" +
                "<td>" + fmtStudyTime(exam.durationSec) + "</td></tr>"
              ).join("") + "</tbody></table>"
            : '<div class="empty-state" style="padding:18px">Шалгалт өгөөгүй байна.</div>') +
        "</div>" +

        '<div class="card">' +
          '<h3 style="margin:0 0 6px">Үйл ажиллагааны түүх</h3>' +
          (st.activityTimeline.length
            ? '<ul class="timeline">' +
              st.activityTimeline.map((item) =>
                "<li><span class='tl-time'>" + fmtDateTime(item.createdAt) + "</span>" +
                esc(item.summary) + "</li>").join("") + "</ul>"
            : '<div class="empty-state" style="padding:18px">Идэвх бүртгэгдээгүй.</div>') +
        "</div>" +
      "</div>";

    /* profile event wiring */
    document.getElementById("profile-back").addEventListener("click", closeProfile);
    document.getElementById("copy-profile-id").addEventListener("click", () => {
      navigator.clipboard.writeText(st.code).then(() => toast("ID хуулагдлаа"));
    });
    profileView.querySelectorAll("[data-extend]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("/api/teacher/students/" + st.id + "/extend", {
            method: "POST",
            body: JSON.stringify({ days: Number(btn.dataset.extend) })
          });
          toast("Эрхийг " + btn.dataset.extend + " хоногоор сунгалаа");
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
        toast("Хадгалагдлаа");
        openProfile(st.id);
      } catch (error) { showError(error.message); }
    });
    const disableBtn = document.getElementById("profile-disable");
    if (disableBtn) {
      disableBtn.addEventListener("click", async () => {
        if (!confirm("Энэ сурагчийн хандах эрхийг түр хаах уу?")) return;
        try {
          await api("/api/teacher/students/" + st.id + "/revoke", { method: "POST" });
          toast("Хандах эрхийг хаалаа");
          openProfile(st.id);
        } catch (error) { showError(error.message); }
      });
    }
    const enableBtn = document.getElementById("profile-enable");
    if (enableBtn) {
      enableBtn.addEventListener("click", async () => {
        try {
          await api("/api/teacher/students/" + st.id + "/enable", { method: "POST" });
          toast("Хандах эрхийг нээлээ");
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
