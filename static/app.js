/* Kindle LLM — minimal no-framework JS for Kindle Scribe browser */

(function () {
  "use strict";

  var messagesEl = document.getElementById("messages");
  var msgInput = document.getElementById("msg-input");
  var sendBtn = document.getElementById("send-btn");
  var errorEl = document.getElementById("error");
  var settingsBtn = document.getElementById("settings-btn");
  var overlay = document.getElementById("settings-overlay");
  var cfgUrl = document.getElementById("cfg-url");
  var cfgModel = document.getElementById("cfg-model");
  var cfgKey = document.getElementById("cfg-key");
  var saveBtn = document.getElementById("save-btn");
  var cancelBtn = document.getElementById("cancel-btn");
  var fetchModelsBtn = document.getElementById("fetch-models-btn");
  var modelSelect = document.getElementById("model-select");

  var chatHistory = []; // {role, content}
  var currentConfig = {}; // cached session config

  // ── Helpers ──────────────────────────────────────────────────────────

  function escapeHTML(s) {
    var d = document.createElement("div");
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  function hideError() {
    errorEl.style.display = "none";
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMsg(role, text) {
    var div = document.createElement("div");
    div.className = role === "user" ? "msg msg-user" : "msg msg-assistant";
    div.innerHTML = (role === "user" ? "You: " : "AI: ") + escapeHTML(text);
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function setLoading(on) {
    sendBtn.disabled = on;
    sendBtn.textContent = on ? "Wait..." : "Send";
  }

  // ── Settings ─────────────────────────────────────────────────────────

  function openSettings() {
    hideError();
    // Load current values from server
    fetch("/api/session/config", { method: "GET" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        cfgUrl.value = data.base_url || "";
        cfgModel.value = data.model || "";
        cfgKey.value = "";
        cfgKey.placeholder = data.has_api_key ? "(key saved — leave blank to keep)" : "sk-... or leave blank";
        overlay.style.display = "block";
      })
      .catch(function () {
        cfgUrl.value = "";
        cfgModel.value = "";
        overlay.style.display = "block";
      });
  }

  function closeSettings() {
    overlay.style.display = "none";
  }

  function saveSettings() {
    hideError();
    var body = {
      base_url: cfgUrl.value.trim(),
      model: cfgModel.value.trim(),
      api_key: cfgKey.value,
    };
    if (!body.base_url) {
      showError("Base URL is required.");
      return;
    }
    fetch("/api/session/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Save failed"); });
        return r.json();
      })
      .then(function () {
        closeSettings();
        refreshModels();
      })
      .catch(function (e) {
        showError(e.message);
      });
  }

  function refreshModels() {
    fetch("/api/session/models", { method: "GET" })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Fetch failed"); });
        return r.json();
      })
      .then(function (data) {
        var models = (data.data || []).map(function (m) { return m.id; });
        var current = currentConfig.model || "";
        modelSelect.innerHTML = "";
        if (models.length === 0) {
          var opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "No models";
          modelSelect.appendChild(opt);
          return;
        }
        models.forEach(function (id) {
          var opt = document.createElement("option");
          opt.value = id;
          opt.textContent = id;
          if (id === current) opt.selected = true;
          modelSelect.appendChild(opt);
        });
      })
      .catch(function () {
        // silently ignore — base_url may not be configured yet
      });
  }

  function onModelChange() {
    var model = modelSelect.value;
    if (!model) return;
    currentConfig.model = model;
    fetch("/api/session/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Save failed"); });
        return r.json();
      })
      .then(function (data) {
        currentConfig.model = data.model;
      })
      .catch(function (e) {
        showError(e.message);
      });
  }

  settingsBtn.onclick = openSettings;
  cancelBtn.onclick = closeSettings;
  saveBtn.onclick = saveSettings;
  fetchModelsBtn.onclick = function () { refreshModels(); };
  modelSelect.onchange = onModelChange;

  // ── Chat ─────────────────────────────────────────────────────────────

  function sendChat() {
    var text = msgInput.value.trim();
    if (!text) return;

    hideError();
    appendMsg("user", text);
    chatHistory.push({ role: "user", content: text });
    msgInput.value = "";
    setLoading(true);

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Chat failed"); });
        return r.json();
      })
      .then(function (data) {
        var reply = data.reply || "(empty response)";
        appendMsg("assistant", reply);
        chatHistory.push({ role: "assistant", content: reply });
      })
      .catch(function (e) {
        showError(e.message);
      })
      .finally(function () {
        setLoading(false);
        msgInput.focus();
      });
  }

  sendBtn.onclick = sendChat;

  // Send on Enter (but shift+enter for newline)
  msgInput.onkeydown = function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  };

  // ── Init ──────────────────────────────────────────────────────────────

  // Pre-load session config so we know if settings are needed
  fetch("/api/session/config", { method: "GET" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      currentConfig = data;
      if (data.model) {
        modelSelect.innerHTML = "";
        var opt = document.createElement("option");
        opt.value = data.model;
        opt.textContent = data.model;
        opt.selected = true;
        modelSelect.appendChild(opt);
      }
      if (data.base_url) {
        refreshModels();
      }
      if (!data.base_url) {
        openSettings();
      }
    });

  msgInput.focus();
})();