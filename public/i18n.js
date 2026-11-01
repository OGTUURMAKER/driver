/* Localization core. Mongolian is the default and canonical language;
   Simplified Chinese is a parallel display layer. Dictionaries live in
   /public/locales/<lang>.js and register themselves through I18N.register.

   Static markup:  <span data-i18n="key">Монгол текст</span>
                   <input data-i18n-attr="placeholder:key; aria-label:key2">
   Scripts:        I18N.t("key", { name: "…" })

   The choice is kept in localStorage; switching reloads the page so every
   screen re-renders from scratch (quiz sessions are already persisted). */
(function () {
  "use strict";

  const LANG_KEY = "dlp.lang";
  const DEFAULT_LANG = "mn";
  const LANGS = [
    { id: "mn", short: "MN", label: "Монгол", htmlLang: "mn" },
    { id: "zh", short: "中文", label: "中文", htmlLang: "zh-CN" }
  ];
  const dictionaries = {};

  function readSavedLang() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (LANGS.some((l) => l.id === saved)) return saved;
    } catch (err) {
      /* storage unavailable — fall back to the default */
    }
    return DEFAULT_LANG;
  }

  const lang = readSavedLang();
  const meta = LANGS.find((l) => l.id === lang);
  document.documentElement.setAttribute("lang", meta.htmlLang);
  document.documentElement.setAttribute("data-lang", lang);

  function register(id, messages) {
    dictionaries[id] = Object.assign(dictionaries[id] || {}, messages);
  }

  function interpolate(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) =>
      params[name] === undefined || params[name] === null ? match : String(params[name]));
  }

  /** Looks up a key in the active language, falling back to Mongolian. */
  function t(key, params) {
    const active = dictionaries[lang] || {};
    const fallback = dictionaries[DEFAULT_LANG] || {};
    const text = active[key] !== undefined ? active[key] : fallback[key];
    if (text === undefined) {
      if (window.console) console.warn("[i18n] missing key:", key);
      return key;
    }
    return interpolate(text, params);
  }

  function has(key) {
    return (dictionaries[lang] && dictionaries[lang][key] !== undefined) ||
      (dictionaries[DEFAULT_LANG] && dictionaries[DEFAULT_LANG][key] !== undefined);
  }

  /** Translates every tagged element under root (default: whole document). */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-attr]").forEach((node) => {
      node.getAttribute("data-i18n-attr").split(";").forEach((pair) => {
        const parts = pair.split(":");
        if (parts.length !== 2) return;
        const attr = parts[0].trim();
        const key = parts[1].trim();
        if (attr && key) node.setAttribute(attr, t(key));
      });
    });
  }

  function setLang(id) {
    if (id === lang || !LANGS.some((l) => l.id === id)) return;
    try {
      localStorage.setItem(LANG_KEY, id);
    } catch (err) {
      return; // cannot persist — keep the current language rather than flip-flopping
    }
    location.reload();
  }

  /** Fills every [data-lang-switch] placeholder with the MN / 中文 toggle. */
  function mountSwitchers(root) {
    (root || document).querySelectorAll("[data-lang-switch]").forEach((host) => {
      host.className = (host.className + " lang-switch").trim();
      host.setAttribute("role", "group");
      host.setAttribute("aria-label", "Хэл / 语言");
      host.innerHTML = "";
      LANGS.forEach((l) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = l.short;
        btn.setAttribute("lang", l.htmlLang);
        btn.setAttribute("title", l.label);
        btn.setAttribute("aria-pressed", String(l.id === lang));
        btn.addEventListener("click", () => setLang(l.id));
        host.appendChild(btn);
      });
    });
  }

  /* ---------- Server messages ----------
     The API answers in Mongolian. Known messages are mapped to keys here so
     the server stays untouched; anything unknown is shown as-is. */
  const SERVER_MESSAGES = {
    "Нууц үг буруу байна.": "server.wrongPassword",
    "Багш нэвтрээгүй байна.": "server.teacherNotSignedIn",
    "Сурагчийн нэр оруулна уу.": "server.nameRequired",
    "Special ID оруулна уу.": "server.codeRequired",
    "ID олдсонгүй. Багшаас авсан Special ID-аа шалгана уу.": "server.codeNotFound",
    "Энэ сурагчийн access багшаар түр хаагдсан байна.": "server.accessDisabled",
    "Таны хандах эрхийн хугацаа дууссан байна. Багштайгаа холбогдоно уу.": "server.accessExpired",
    "Сурагч олдсонгүй.": "server.studentNotFound",
    "Нэвтрээгүй байна.": "server.notSignedIn",
    "Тест үзэхийн тулд нэвтэрнэ үү.": "server.signInToView",
    "Тест шалгуулахын тулд нэвтэрнэ үү.": "server.signInToSubmit",
    "Танд дүрмийн тестийн эрх олгогдоогүй байна.": "server.noRegular",
    "Танд «Ангилал ахиулах» шалгалтын эрх олгогдоогүй байна. Багштайгаа холбогдоно уу.": "server.noUpgrade",
    "Тест олдсонгүй.": "server.testNotFound",
    "Хүсэлт олдсонгүй.": "server.requestNotFound",
    "Алдаа гарлаа.": "common.error",
    "File not found": "server.requestNotFound"
  };

  function serverMessage(message) {
    const text = String(message || "");
    if (SERVER_MESSAGES[text]) return t(SERVER_MESSAGES[text]);
    const status = text.match(/^Алдаа гарлаа \((\d+)\)$/);
    if (status) return t("common.errorStatus", { status: status[1] });
    return text;
  }

  /* ---------- Teacher activity log ----------
     Activity summaries are stored in Mongolian (they are records, not UI), so
     they are translated for display only, by pattern. Unknown lines pass through. */
  const ACTIVITY_PATTERNS = [
    [/^Системд нэвтэрсэн$/, () => t("activity.login")],
    [/^Бүлэг (\d+) эхлүүлсэн \((Шалгалт|Сургалт)\)$/, (m) =>
      t("activity.chapterStart", { chapter: m[1], mode: modeName(m[2]) })],
    [/^Бүлэг (\d+) дуусгасан — (\d+)\/(\d+) \((Шалгалт|Сургалт)\)$/, (m) =>
      t("activity.chapterFinish", { chapter: m[1], score: m[2], total: m[3], mode: modeName(m[4]) })],
    [/^Ангилал ахиулах — Тест (\d+) эхлүүлсэн$/, (m) => t("activity.upgradeStart", { test: m[1] })],
    [/^Ангилал ахиулах — Тест (\d+) дуусгасан — (\d+)\/(\d+)$/, (m) =>
      t("activity.upgradeFinish", { test: m[1], score: m[2], total: m[3] })],
    [/^Багш access-ийг цуцалсан$/, () => t("activity.revoked")],
    [/^Багш access-ийг идэвхжүүлсэн$/, () => t("activity.enabled")],
    [/^Багш хандах эрхийг (.+) хүртэл сунгасан$/, (m) => t("activity.extended", { date: m[1] })],
    [/^Багш шалгалтын эрхийг өөрчилсөн: (.+)$/, (m) =>
      t("activity.entitlements", { list: m[1].split(", ").map(entitlementName).join(lang === "zh" ? "、" : ", ") })]
  ];

  function modeName(mn) {
    return mn === "Шалгалт" ? t("mode.exam") : t("mode.learning");
  }

  function entitlementName(mn) {
    if (mn.indexOf("Дүрмийн тест") === 0) return t("entitlement.regularLong");
    if (mn === "Ангилал ахиулах") return t("entitlement.upgrade");
    return mn;
  }

  function activity(summary) {
    const text = String(summary || "");
    if (lang === DEFAULT_LANG) return text;
    for (const [pattern, render] of ACTIVITY_PATTERNS) {
      const match = text.match(pattern);
      if (match) return render(match);
    }
    return text;
  }

  /* Runs once. Page scripts call it first thing (they sit at the end of
     <body>, before DOMContentLoaded) so static text is translated before
     they render anything dynamic; DOMContentLoaded is the fallback. */
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    apply();
    mountSwitchers();
  }

  window.I18N = {
    boot,
    lang,
    DEFAULT_LANG,
    LANGS,
    register,
    t,
    has,
    apply,
    setLang,
    mountSwitchers,
    serverMessage,
    activity
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
