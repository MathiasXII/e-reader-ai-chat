/* E-Reader LLM — minimal no-framework JS for e-reader browsers */

(function () {
  "use strict";

  var messagesEl = document.getElementById("messages");
  var msgInput = document.getElementById("msg-input");
  var sendBtn = document.getElementById("send-btn");
  var errorEl = document.getElementById("error");
  var settingsBtn = document.getElementById("settings-btn");
  var overlay = document.getElementById("settings-overlay");
  var cfgUrl = document.getElementById("cfg-url");
  var cfgKey = document.getElementById("cfg-key");
  var saveBtn = document.getElementById("save-btn");
  var cancelBtn = document.getElementById("cancel-btn");
  var modelInput = document.getElementById("model-input");
  var modelDropdown = document.getElementById("model-dropdown");
  var cfgDisplayNames = document.getElementById("cfg-display-names");

  var allModels = []; // full list of model ids from API
  var chatHistory = []; // {role, content}
  var currentConfig = {}; // cached session config

  // ── Compatibility helpers ─────────────────────────────────────────────

  // XHR wrapper replacing fetch()/Promise for WebKit 533 (Kobo Touch).
  // body: plain object (will be JSON-stringified) or null for GET requests.
  // onDone(data): called with parsed JSON on 2xx.
  // onError(msg): called with error string on non-2xx or network failure.
  function ajax(method, url, body, onDone, onError) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    if (body !== null) {
      xhr.setRequestHeader("Content-Type", "application/json");
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onDone) onDone(data);
      } else {
        var msg = (data && data.detail) ? data.detail : ("Request failed (" + xhr.status + ")");
        if (onError) onError(msg);
      }
    };
    xhr.onerror = function () {
      if (onError) onError("Network error");
    };
    xhr.send(body !== null ? JSON.stringify(body) : null);
  }

  // Node.contains() is absent in WebKit 533. Walk parentNode chain instead.
  function nodeContains(parent, child) {
    if (parent === child) return true;
    var node = child;
    while (node) {
      if (node === parent) return true;
      node = node.parentNode;
    }
    return false;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  function escapeHTML(s) {
    var d = document.createElement("div");
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function latexToHTML(latex, display) {
    var s = latex;
    // Strip \begin{...}/\end{...} wrappers
    s = s.replace(/\\begin\{[^}]+\}/g, "").replace(/\\end\{[^}]+\}/g, "");

    // Greek letters
    var greeks = {
      alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ε",
      varepsilon:"ε",zeta:"ζ",eta:"η",theta:"θ",vartheta:"ϑ",
      iota:"ι",kappa:"κ",lambda:"λ",mu:"μ",nu:"ν",
      xi:"ξ",pi:"π",varpi:"ϖ",rho:"ρ",varrho:"ϱ",
      sigma:"σ",varsigma:"ς",tau:"τ",upsilon:"υ",phi:"φ",
      varphi:"ϕ",chi:"χ",psi:"ψ",omega:"ω",
      Gamma:"Γ",Delta:"Δ",Theta:"Θ",Lambda:"Λ",Xi:"Ξ",
      Pi:"Π",Sigma:"Σ",Phi:"Φ",Psi:"Ψ",Omega:"Ω"
    };
    for (var g in greeks) {
      s = s.replace(new RegExp("\\\\" + g + "(?![a-zA-Z])", "g"), greeks[g]);
    }

    // Superscript: ^{...} or ^x
    s = s.replace(/\^{([^}]*)}/g, "<sup>$1</sup>");
    s = s.replace(/\^([0-9a-zA-Z])/g, "<sup>$1</sup>");

    // Subscript: _{...} or _x (but not \_escaped)
    // Replace \_ with a placeholder first, do subscripts, then restore
    s = s.replace(/\\_/g, "\x00US");
    s = s.replace(/_\{([^}]*)}/g, "<sub>$1</sub>");
    s = s.replace(/_([0-9a-zA-Z])/g, "<sub>$1</sub>");
    s = s.replace(/\x00US/g, "_");

    // Fractions: \frac{a}{b}
    s = s.replace(/\\frac\{([^}]*)}\\{([^}]*)}/g, '<span class="md-frac">$1<span class="md-frac-bar"></span>$2</span>');

    // Square root: \sqrt{...}
    s = s.replace(/\\sqrt\{([^}]*)}/g, "√<span style=\"text-decoration:overline\">$1</span>");

    // Common symbols
    var symbols = {
      "\\infty":"∞", "\\pm":"±", "\\mp":"∓",
      "\\times":"×", "\\div":"÷", "\\cdot":"·",
      "\\neq":"≠", "\\leq":"≤", "\\geq":"≥",
      "\\lt":"<", "\\gt":">",
      "\\approx":"≈", "\\equiv":"≡", "\\sim":"∼",
      "\\propto":"∝",
      "\\rightarrow":"→", "\\leftarrow":"←",
      "\\Rightarrow":"⇒", "\\Leftarrow":"⇐",
      "\\to":"→",
      "\\in":"∈", "\\notin":"∉",
      "\\subset":"⊂", "\\supset":"⊃",
      "\\subseteq":"⊆", "\\supseteq":"⊇",
      "\\cup":"∪", "\\cap":"∩",
      "\\emptyset":"∅", "\\varnothing":"∅",
      "\\forall":"∀", "\\exists":"∃",
      "\\nabla":"∇", "\\partial":"∂",
      "\\sum":"∑", "\\prod":"∏",
      "\\int":"∫", "\\oint":"∮",
      "\\cdot":"·", "\\ldots":"…", "\\cdots":"⋯",
      "\\quad":" ", "\\qquad":"  ",
      "\\,":" ", "\\;":" ", "\\!":"",
      "\\{":"{", "\\}":"}"
    };
    for (var sym in symbols) {
      s = s.replace(new RegExp(sym.replace(/([\\\{}[\]])/g, "\\$1"), "g"), symbols[sym]);
    }

    // Text in brackets: \text{...}
    s = s.replace(/\\text\{([^}]*)}/g, "$1");
    // Overline, hat, bar decorations
    s = s.replace(/\\hat\{([^}]*)}/g, "$1̂");
    s = s.replace(/\\bar\{([^}]*)}/g, "$1̄");
    s = s.replace(/\\vec\{([^}]*)}/g, "$1⃗");
    s = s.replace(/\\dot\{([^}]*)}/g, "$1̇");
    s = s.replace(/\\ddot\{([^}]*)}/g, "$1̈");
    // Tilde accent
    s = s.replace(/\\tilde\{([^}]*)}/g, "$1̃");

    // Clean up remaining backslash commands: \operatorname{...}, \textbf{...}, etc.
    s = s.replace(/\\(?:operatorname|textbf|textit|mathrm|mathbf|mathit|mathsf|mathtt|bm|boldsymbol|mathcal|mathbb|mathfrak|mathscr)\{([^}]*)}/g, "$1");
    // \left \right delimiters (cosmetic only, just strip them)
    s = s.replace(/\\left[([|\\.]/g, "").replace(/\\right[)\]|\\.]/g, "");
    // \quad, \qquad already handled above
    // Strip remaining unknown commands: \command → just remove the backslash
    s = s.replace(/\\([a-zA-Z]+)/g, "$1");
    // Curly braces that are just grouping
    s = s.replace(/\{([^}]*)}/g, "$1");
    // Remaining stray braces
    s = s.replace(/[{}]/g, "");

    return s;
  }

  function markdownToHTML(text) {
    var placeholders = [];
    function ph(html) {
      placeholders.push(html);
      return "\x00P" + (placeholders.length - 1) + "\x00";
    }

    // 1. Fenced code blocks
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
      var escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return ph('<pre class="md-code-block"><code>' + escaped + "</code></pre>");
    });

    // 2. Inline code
    text = text.replace(/`([^`\n]+?)`/g, function(_, code) {
      var escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return ph('<code class="md-inline-code">' + escaped + "</code>");
    });

    // 3. Math — display ($$...$$) then inline ($...$)
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function(_, math) {
      return ph('<div class="md-math md-math-display">' + latexToHTML(math, true) + "</div>");
    });
    text = text.replace(/\$([^\$\n]+?)\$/g, function(_, math) {
      return ph('<span class="md-math md-math-inline">' + latexToHTML(math, false) + "</span>");
    });

    // 4. Escape remaining HTML (outside code)
    text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // 4. Escape accidental placeholder-like sequences in normal text
    // (ph uses \x00P which won't appear naturally, so this is safe)

    // 5. Links (before bold/italic so brackets aren't mangled)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // 6. Bold + italic (***text***)
    text = text.replace(/\*{3}(.+?)\*{3}/g, "<strong><em>$1</em></strong>");
    // Bold (**text** or __text__)
    text = text.replace(/\*{2}(.+?)\*{2}/g, "<strong>$1</strong>");
    text = text.replace(/_{2}(.+?)_{2}/g, "<strong>$1</strong>");
    // Italic (*text* or _text_) — single char, not inside a tag
    text = text.replace(/(^|[\s(])(\*|_)(.+?)\2([\s).,;:!?]|$)/g, "$1<em>$3</em>$4");

    // 7. Process lines into block elements
    var lines = text.split("\n");
    var html = "";
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      // Horizontal rule
      if (/^[-*_]{3,}\s*$/.test(line)) {
        html += "<hr>";
        i++;
        continue;
      }

      // Heading
      var hm = line.match(/^(#{1,6})\s+(.+)/);
      if (hm) {
        var lvl = hm[1].length;
        html += "<h" + lvl + ">" + hm[2] + "</h" + lvl + ">";
        i++;
        continue;
      }

      // Blockquote
      if (/^&gt;\s?/.test(line)) {
        var bqLines = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
          bqLines.push(lines[i].replace(/^&gt;\s?/, ""));
          i++;
        }
        html += "<blockquote>" + bqLines.join("<br>") + "</blockquote>";
        continue;
      }

      // Unordered list
      if (/^[\-*]\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^[\-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^[\-*]\s+/, ""));
          i++;
        }
        html += "<ul>" + items.map(function(t) { return "<li>" + t + "</li>"; }).join("") + "</ul>";
        continue;
      }

      // Ordered list
      if (/^\d+\.\s+/.test(line)) {
        var oItems = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          oItems.push(lines[i].replace(/^\d+\.\s+/, ""));
          i++;
        }
        html += "<ol>" + oItems.map(function(t) { return "<li>" + t + "</li>"; }).join("") + "</ol>";
        continue;
      }

      // Blank line — paragraph break
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      // Regular text — collect consecutive non-blank, non-block lines into a paragraph
      var pLines = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^&gt;\s?/.test(lines[i]) && !/^[\-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i]) && !/^[-*_]{3,}\s*$/.test(lines[i]) && !/^\x00P/.test(lines[i])) {
        pLines.push(lines[i]);
        i++;
      }
      if (pLines.length === 0) {
        // Placeholder-only line (code block)
        if (/^\x00P/.test(lines[i])) {
          html += lines[i];
          i++;
        } else {
          i++;
        }
        continue;
      }
      html += "<p>" + pLines.join("<br>") + "</p>";
    }

    // 8. Restore placeholders
    for (var j = 0; j < placeholders.length; j++) {
      html = html.replace("\x00P" + j + "\x00", placeholders[j]);
    }

    return html;
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
    var label = (role === "user" ? "You: " : "AI: ");
    var content = role === "user" ? escapeHTML(text) : markdownToHTML(text);
    div.innerHTML = (currentConfig.display_names !== false ? label : "") + content;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function renderAllMessages() {
    // Re-render chat history with current display_names setting
    messagesEl.innerHTML = '<div id="error"></div>';
    errorEl = document.getElementById("error");
    for (var i = 0; i < chatHistory.length; i++) {
      var msg = chatHistory[i];
      var div = document.createElement("div");
      div.className = msg.role === "user" ? "msg msg-user" : "msg msg-assistant";
      var label = (msg.role === "user" ? "You: " : "AI: ");
      var content = msg.role === "user" ? escapeHTML(msg.content) : markdownToHTML(msg.content);
      div.innerHTML = (currentConfig.display_names !== false ? label : "") + content;
      messagesEl.appendChild(div);
    }
    scrollToBottom();
  }

  function setLoading(on) {
    sendBtn.disabled = on;
    sendBtn.textContent = on ? "Wait..." : "Send";
  }

  // ── Settings ─────────────────────────────────────────────────────────

  function openSettings() {
    hideError();
    ajax("GET", "/api/session/config", null,
      function (data) {
        cfgUrl.value = data.base_url || "";
        cfgKey.value = "";
        cfgKey.placeholder = data.has_api_key ? "(key saved — leave blank to keep)" : "sk-... or leave blank";
        cfgDisplayNames.checked = data.display_names !== false;
        overlay.style.display = "block";
      },
      function () {
        cfgUrl.value = "";
        cfgDisplayNames.checked = true;
        overlay.style.display = "block";
      }
    );
  }

  function closeSettings() {
    overlay.style.display = "none";
  }

  function saveSettings() {
    hideError();
    var body = {
      base_url: cfgUrl.value.trim(),
      api_key: cfgKey.value,
      display_names: cfgDisplayNames.checked,
    };
    if (!body.base_url) {
      showError("Base URL is required.");
      return;
    }
    ajax("POST", "/api/session/config", body,
      function (data) {
        currentConfig.display_names = data.display_names !== false;
        closeSettings();
        renderAllMessages();
        refreshModels();
      },
      function (msg) {
        showError(msg);
      }
    );
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
    ajax("POST", "/api/session/config", { model: model },
      function (data) {
        currentConfig.model = data.model;
      },
      function (msg) {
        showError(msg);
      }
    );
  }

  function refreshModels() {
    ajax("GET", "/api/session/models", null,
      function (data) {
        allModels = (data.data || []).map(function (m) { return m.id; });
        renderModels(modelInput.value);
      },
      null // silently ignore — base_url may not be configured yet
    );
  }

  settingsBtn.onclick = openSettings;
  cancelBtn.onclick = closeSettings;
  saveBtn.onclick = saveSettings;

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
    if (!nodeContains(modelInput, e.target) && !nodeContains(modelDropdown, e.target)) {
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

    ajax("POST", "/api/chat", { messages: chatHistory },
      function (data) {
        var reply = data.reply || "(empty response)";
        appendMsg("assistant", reply);
        chatHistory.push({ role: "assistant", content: reply });
        setLoading(false);
        msgInput.focus();
      },
      function (msg) {
        showError(msg);
        setLoading(false);
        msgInput.focus();
      }
    );
  }

  sendBtn.onclick = sendChat;

  // Send on Enter (but shift+enter for newline).
  // Use keyCode as fallback for WebKit 533 which lacks e.key.
  msgInput.onkeydown = function (e) {
    var key = e.key || "";
    var code = e.keyCode || e.which || 0;
    if ((key === "Enter" || code === 13) && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  };

  // ── Init ──────────────────────────────────────────────────────────────

  // Pre-load session config so we know if settings are needed
  ajax("GET", "/api/session/config", null,
    function (data) {
      currentConfig = data;
      if (data.model) {
        modelInput.value = data.model;
      }
      if (data.display_names === false) {
        currentConfig.display_names = false;
      }
      if (data.base_url) {
        refreshModels();
      }
      if (!data.base_url) {
        openSettings();
      }
    },
    null
  );

  msgInput.focus();
})();
