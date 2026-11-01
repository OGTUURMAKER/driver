/* Login page: students enter their Special Access ID, instructors a password.
   Valid existing sessions are redirected straight to their home page. */
(function () {
  "use strict";

  const studentForm = document.getElementById("student-login-form");
  const studentMessage = document.getElementById("student-message");
  const teacherForm = document.getElementById("teacher-login-form");
  const teacherMessage = document.getElementById("teacher-message");
  const teacherCard = document.getElementById("teacher-card");
  const teacherToggle = document.getElementById("teacher-toggle");

  if (new URLSearchParams(location.search).get("expired") === "1") {
    document.getElementById("expired-banner").hidden = false;
  }

  teacherToggle.addEventListener("click", () => {
    teacherCard.hidden = !teacherCard.hidden;
    if (!teacherCard.hidden) teacherCard.querySelector("input").focus();
  });

  const t = window.I18N.t;

  function setMessage(element, text, ok) {
    element.textContent = text;
    element.className = "message show " + (ok ? "ok" : "error");
  }

  /* Redirect already-authenticated visitors (verify tokens, drop stale ones). */
  (async () => {
    const teacherToken = localStorage.getItem("teacherToken");
    if (teacherToken) {
      const res = await fetch("/api/teacher/me", {
        headers: { Authorization: "Bearer " + teacherToken }
      }).catch(() => null);
      if (res && res.ok) {
        location.href = "/teacher";
        return;
      }
      localStorage.removeItem("teacherToken");
    }
    const studentToken = localStorage.getItem("studentToken");
    if (studentToken) {
      const res = await fetch("/api/student/me", {
        headers: { Authorization: "Bearer " + studentToken }
      }).catch(() => null);
      if (res && res.ok) {
        location.href = "/";
        return;
      }
      localStorage.removeItem("studentToken");
    }
  })();

  studentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = String(new FormData(studentForm).get("code") || "").trim().toUpperCase();
    try {
      const res = await fetch("/api/student/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(window.I18N.serverMessage(data.error) || t("common.error"));
      localStorage.setItem("studentToken", data.token);
      setMessage(studentMessage, t("login.welcome", { name: data.student.name }), true);
      location.href = "/";
    } catch (error) {
      setMessage(studentMessage, error.message, false);
    }
  });

  teacherForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = String(new FormData(teacherForm).get("password") || "").trim();
    try {
      const res = await fetch("/api/teacher/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(window.I18N.serverMessage(data.error) || t("common.error"));
      localStorage.setItem("teacherToken", data.token);
      location.href = "/teacher";
    } catch (error) {
      setMessage(teacherMessage, error.message, false);
    }
  });
})();
