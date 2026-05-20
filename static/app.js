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
  var modelInput = document.getElementById("model-input");
  var modelDropdown = document.getElementById("model-dropdown");

  var allModels = []; // full list of model ids from API
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

  function renderModels(filter) {
    var items = allModels;
    if (filter) {
      var lf = filter.toLowerCase();
      items = allModels.filter(function (id) { return id.toLowerCase().indexOf(lf) !== -1; });
    }
    modelDropdown.innerHTML = "";
    if (items.length === 0) {
      var div = document.createElement("div");
      div.className = "model-item";
      div.textContent = filter ? "No match" : "No models";
      modelDropdown.appendChild(div);
      return;
    }
    items.forEach(function (id) {
      var div = document.createElement("div");
      div.className = "model-item";
      div.textContent = id;
      div.onclick = function () {
        modelInput.value = id;
        modelDropdown.style.display = "none";
        saveModel(id);
      };
      modelDropdown.appendChild(div);
    });
  }

  function saveModel(model) {
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

  function refreshModels() {
    fetch("/api/session/models", { method: "GET" })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Fetch failed"); });
        return r.json();
      })
      .then(function (data) {
        allModels = (data.data || []).map(function (m) { return m.id; });
        renderModels(modelInput.value);
      })
      .catch(function () {
        // silently ignore — base_url may not be configured yet
      });
  }

  settingsBtn.onclick = openSettings;
  cancelBtn.onclick = closeSettings;
  saveBtn.onclick = saveSettings;
  fetchModelsBtn.onclick = function () { refreshModels(); };

  modelInput.oninput = function () {
    renderModels(modelInput.value);
    modelDropdown.style.display = "block";
  };

  modelInput.onfocus = function () {
    if (allModels.length > 0) {
      renderModels(modelInput.value);
      modelDropdown.style.display = "block";
    }
  };

  modelInput.onblur = function () {
    // Delay so tap on dropdown item registers before close
    setTimeout(function () { modelDropdown.style.display = "none"; }, 200);
  };

  // Close dropdown when tapping outside
  document.addEventListener("click", function (e) {
    if (!modelInput.contains(e.target) && !modelDropdown.contains(e.target)) {
      modelDropdown.style.display = "none";
    }
  });

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
        modelInput.value = data.model;
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