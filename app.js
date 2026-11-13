(() => {
  "use strict";

  const MODEL_PAGE = "https://huggingface.co/xtools-at/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic";
  const COLAB_URL = "https://colab.research.google.com/github/JOAO2666/deepseek-v4-mobile/blob/main/colab/DeepSeek_V4_Pro_9B_Heretic_Colab.ipynb";

  const DEFAULT_SETTINGS = {
    backend: "auto",
    customUrl: "",
    hfToken: "",
    systemPrompt:
      "Você é um assistente prestativo, direto e sem censura, com alta capacidade matemática e de raciocínio. Responda sempre no mesmo idioma do usuário.",
    maxTokens: 2048,
    temperature: 0.7,
    thinking: true,
    theme: "dark",
  };

  const BACKENDS = {
    echotree: {
      id: "echotree",
      label: "Echotree · A10G BF16",
      baseUrl: "https://echotree-deepseek-v4-pro-9b-heretic.hf.space",
      multimodal: true,
    },
    jakubicek: {
      id: "jakubicek",
      label: "Jakubicek · A10G BF16",
      baseUrl: "https://jakubicek-moj-botik.hf.space",
      multimodal: false,
    },
    bimapopo345: {
      id: "bimapopo345",
      label: "Bimapopo345 · A10G 4-bit",
      baseUrl: "https://bimapopo345-deepseek-v4-gguf-playground.hf.space",
      multimodal: false,
    },
  };

  const STARTERS = [
    { tag: "Raciocínio", text: "Prove passo a passo por que a raiz quadrada de 2 é irracional." },
    { tag: "Programação", text: "Escreva uma API REST em Python com FastAPI usando tipagem moderna e validação." },
    { tag: "Matemática", text: "Um trem sai às 14:20 e percorre 135 km a 90 km/h. Que horas ele chega?" },
    { tag: "Direto", text: "Explique de forma clara como funciona atenção linear vs atenção softmax em LLMs." },
  ];

  // State
  let settings = loadJSON("ds_v4_settings", DEFAULT_SETTINGS);
  let chats = loadJSON("ds_v4_chats", []);
  let activeChatId = localStorage.getItem("ds_v4_active_chat") || null;
  let pendingImages = []; // [{ file, dataUrl }]
  let activeAbort = null;
  let isGenerating = false;

  // DOM refs
  const $ = (id) => document.getElementById(id);
  const sidebar = $("sidebar");
  const sidebarBackdrop = $("sidebar-backdrop");
  const chatListEl = $("chat-list");
  const messagesScroll = $("messages-scroll");
  const messagesInner = $("messages-inner");
  const composerForm = $("composer-form");
  const promptInput = $("prompt-input");
  const fileInput = $("file-input");
  const attachmentStrip = $("attachment-strip");
  const btnAttach = $("btn-attach");
  const btnThinking = $("btn-thinking");
  const btnSend = $("btn-send");
  const iconSend = $("icon-send");
  const iconStop = $("icon-stop");
  const statusDot = $("status-dot");
  const backendLabelEl = $("backend-label");
  const settingsModal = $("settings-modal");
  const selectBackend = $("select-backend");
  const customUrlField = $("custom-url-field");
  const inputCustomUrl = $("input-custom-url");
  const inputHfToken = $("input-hf-token");
  const inputSystem = $("input-system");
  const inputMaxTokens = $("input-max-tokens");
  const inputTemp = $("input-temp");

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return structuredClone(fallback);
      const parsed = JSON.parse(raw);
      if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : structuredClone(fallback);
      return { ...fallback, ...parsed };
    } catch {
      return structuredClone(fallback);
    }
  }

  function saveChats() {
    // Strip large base64 previews from persisted storage beyond safety cap
    const compact = chats.slice(0, 30).map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({
        ...m,
        images: undefined,
        imageCount: m.imageCount || (m.images ? m.images.length : 0),
      })),
    }));
    try {
      localStorage.setItem("ds_v4_chats", JSON.stringify(compact));
    } catch {
      // Ignore quota errors on older browsers
    }
    if (activeChatId) localStorage.setItem("ds_v4_active_chat", activeChatId);
  }

  function saveSettings() {
    localStorage.setItem("ds_v4_settings", JSON.stringify(settings));
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f7f7f8" : "#0e0f11");
  }

  function getActiveChat() {
    return chats.find((c) => c.id === activeChatId) || null;
  }

  function createNewChat() {
    const id = "chat_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const chat = { id, title: "Nova conversa", updatedAt: Date.now(), messages: [] };
    chats.unshift(chat);
    activeChatId = id;
    saveChats();
    renderChatList();
    renderMessages();
    closeSidebar();
    return chat;
  }

  function ensureActiveChat() {
    return getActiveChat() || createNewChat();
  }

  function openSidebar() {
    sidebar.classList.add("open");
    sidebarBackdrop.classList.add("open");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("open");
  }

  function updateStatusBadge(state, customText) {
    statusDot.className = "status-dot" + (state ? " " + state : "");
    if (customText) {
      backendLabelEl.textContent = customText;
      return;
    }
    if (settings.backend === "custom") {
      backendLabelEl.textContent = settings.customUrl ? "Meu Colab · Custom" : "Colab (configure URL)";
    } else if (settings.backend === "auto") {
      backendLabelEl.textContent = "Auto · A10G ZeroGPU";
    } else {
      backendLabelEl.textContent = BACKENDS[settings.backend]?.label || "A10G ZeroGPU";
    }
  }

  function updateComposerState() {
    btnThinking.classList.toggle("active", Boolean(settings.thinking));
    btnThinking.setAttribute("aria-pressed", String(Boolean(settings.thinking)));

    if (isGenerating) {
      btnSend.disabled = false;
      btnSend.classList.add("stop");
      btnSend.setAttribute("aria-label", "Parar geração");
      iconSend.hidden = true;
      iconStop.hidden = false;
    } else {
      const hasInput = promptInput.value.trim().length > 0 || pendingImages.length > 0;
      btnSend.disabled = !hasInput;
      btnSend.classList.remove("stop");
      btnSend.setAttribute("aria-label", "Enviar mensagem");
      iconSend.hidden = false;
      iconStop.hidden = true;
    }
  }

  function renderAttachments() {
    attachmentStrip.innerHTML = "";
    if (!pendingImages.length) {
      attachmentStrip.hidden = true;
      updateComposerState();
      return;
    }
    attachmentStrip.hidden = false;
    pendingImages.forEach((item, idx) => {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      const img = document.createElement("img");
      img.src = item.dataUrl;
      img.alt = item.file.name || "Imagem";
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "attachment-remove";
      rm.textContent = "×";
      rm.setAttribute("aria-label", "Remover imagem");
      rm.onclick = () => {
        pendingImages.splice(idx, 1);
        renderAttachments();
      };
      chip.append(img, rm);
      attachmentStrip.appendChild(chip);
    });
    updateComposerState();
  }

  function renderChatList() {
    chatListEl.innerHTML = "";
    if (!chats.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding: 14px 10px; font-size: 12.5px; color: var(--text-muted);";
      empty.textContent = "Nenhuma conversa salva ainda.";
      chatListEl.appendChild(empty);
      return;
    }
    chats.forEach((chat) => {
      const row = document.createElement("div");
      row.className = "chat-item" + (chat.id === activeChatId ? " active" : "");

      const titleBtn = document.createElement("button");
      titleBtn.type = "button";
      titleBtn.className = "chat-item-title";
      titleBtn.textContent = chat.title || "Nova conversa";
      titleBtn.onclick = () => {
        activeChatId = chat.id;
        saveChats();
        renderChatList();
        renderMessages();
        closeSidebar();
      };

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "chat-item-del";
      delBtn.setAttribute("aria-label", "Excluir conversa");
      delBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        chats = chats.filter((c) => c.id !== chat.id);
        if (activeChatId === chat.id) {
          activeChatId = chats[0]?.id || null;
        }
        saveChats();
        renderChatList();
        renderMessages();
      };

      row.append(titleBtn, delBtn);
      chatListEl.appendChild(row);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatInline(text) {
    let out = escapeHtml(text);
    // Inline code
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Bold
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // Italic
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    // Links (only http/https)
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return out;
  }

  function renderMarkdown(md) {
    if (!md) return "";
    const blocks = [];
    const fenced = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = fenced.exec(md)) !== null) {
      if (match.index > lastIndex) {
        blocks.push({ type: "text", value: md.slice(lastIndex, match.index) });
      }
      blocks.push({ type: "code", lang: match[1] || "texto", value: match[2].replace(/\n$/, "") });
      lastIndex = fenced.lastIndex;
    }
    if (lastIndex < md.length) {
      blocks.push({ type: "text", value: md.slice(lastIndex) });
    }

    return blocks
      .map((blk) => {
        if (blk.type === "code") {
          const codeId = "code_" + Math.random().toString(36).slice(2, 9);
          return (
            `<div class="code-block">` +
            `<div class="code-block-head"><span>${escapeHtml(blk.lang)}</span>` +
            `<button type="button" class="btn-copy-code" data-copy-target="${codeId}">Copiar</button></div>` +
            `<pre><code id="${codeId}">${escapeHtml(blk.value)}</code></pre></div>`
          );
        }

        const lines = blk.value.split("\n");
        let html = "";
        let inUl = false;
        let inOl = false;

        const closeLists = () => {
          if (inUl) { html += "</ul>"; inUl = false; }
          if (inOl) { html += "</ol>"; inOl = false; }
        };

        for (const rawLine of lines) {
          const line = rawLine.trimEnd();
          if (!line.trim()) {
            closeLists();
            continue;
          }
          const h3 = line.match(/^###\s+(.+)/);
          const h2 = line.match(/^##\s+(.+)/);
          const h1 = line.match(/^#\s+(.+)/);
          const ul = line.match(/^[-*]\s+(.+)/);
          const ol = line.match(/^\d+\.\s+(.+)/);

          if (h3) {
            closeLists();
            html += `<h3>${formatInline(h3[1])}</h3>`;
          } else if (h2) {
            closeLists();
            html += `<h2>${formatInline(h2[1])}</h2>`;
          } else if (h1) {
            closeLists();
            html += `<h1>${formatInline(h1[1])}</h1>`;
          } else if (ul) {
            if (inOl) { html += "</ol>"; inOl = false; }
            if (!inUl) { html += "<ul>"; inUl = true; }
            html += `<li>${formatInline(ul[1])}</li>`;
          } else if (ol) {
            if (inUl) { html += "</ul>"; inUl = false; }
            if (!inOl) { html += "<ol>"; inOl = true; }
            html += `<li>${formatInline(ol[1])}</li>`;
          } else {
            closeLists();
            html += `<p>${formatInline(line)}</p>`;
          }
        }
        closeLists();
        return html;
      })
      .join("");
  }

  function renderWelcome() {
    const wrap = document.createElement("div");
    wrap.className = "welcome-screen";
    wrap.innerHTML = `
      <div class="welcome-header">
        <img class="welcome-icon" src="icon.svg" alt="Ícone DeepSeek V4">
        <div>
          <h1 class="welcome-title">DeepSeek-V4-Pro · Qwen3.5-9B</h1>
          <p class="welcome-sub">Heretic Uncensored · Raciocínio em GPU A10G direto no celular</p>
        </div>
      </div>
      <div class="starter-grid"></div>
      <div class="colab-callout">
        <div class="colab-callout-text">
          <strong>Quer sua própria GPU dedicada sem fila?</strong><br>
          Inicie em 1 clique no Google Colab (4-bit T4) e cole a URL aqui nas configurações.
        </div>
        <a class="btn-secondary" href="${COLAB_URL}" target="_blank" rel="noopener noreferrer">Abrir no Colab</a>
      </div>
    `;
    const grid = wrap.querySelector(".starter-grid");
    STARTERS.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "starter-btn";
      btn.innerHTML = `<span class="starter-tag">${escapeHtml(s.tag)}</span><span class="starter-text">${escapeHtml(s.text)}</span>`;
      btn.onclick = () => {
        promptInput.value = s.text;
        autoResizeTextarea();
        updateComposerState();
        sendMessage();
      };
      grid.appendChild(btn);
    });
    return wrap;
  }

  function renderMessages() {
    const chat = getActiveChat();
    messagesInner.innerHTML = "";
    if (!chat || !chat.messages.length) {
      messagesInner.appendChild(renderWelcome());
      return;
    }

    chat.messages.forEach((msg) => {
      const row = document.createElement("div");
      row.className = `msg-row ${msg.role}`;

      if (msg.role === "user") {
        const bubble = document.createElement("div");
        bubble.className = "msg-bubble-user";
        if (msg.images && msg.images.length) {
          const imgGrid = document.createElement("div");
          imgGrid.className = "msg-images";
          msg.images.forEach((src) => {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "Anexo";
            imgGrid.appendChild(img);
          });
          bubble.appendChild(imgGrid);
        } else if (msg.imageCount) {
          const note = document.createElement("div");
          note.style.cssText = "font-size:12px;color:var(--text-secondary);margin-bottom:4px;";
          note.textContent = `[${msg.imageCount} imagem(ns) anexada(s)]`;
          bubble.appendChild(note);
        }
        const textNode = document.createElement("div");
        textNode.textContent = msg.text || "";
        bubble.appendChild(textNode);
        row.appendChild(bubble);
      } else {
        const wrap = document.createElement("div");
        wrap.className = "msg-assistant-wrap";

        if (msg.backendName) {
          const meta = document.createElement("div");
          meta.className = "msg-meta";
          meta.textContent = msg.backendName;
          wrap.appendChild(meta);
        }

        if (msg.reasoning) {
          const det = document.createElement("details");
          det.className = "thinking-box";
          if (msg.streaming && !msg.text) det.open = true;
          const sum = document.createElement("summary");
          sum.textContent = msg.streaming && !msg.text ? "Pensando..." : "Ver processo de raciocínio";
          const content = document.createElement("div");
          content.className = "thinking-content";
          content.textContent = msg.reasoning;
          det.append(sum, content);
          wrap.appendChild(det);
        }

        if (msg.error) {
          const errCard = document.createElement("div");
          errCard.className = "error-card";
          const errText = document.createElement("div");
          errText.innerHTML = renderMarkdown(msg.error);
          const actions = document.createElement("div");
          actions.className = "error-actions";

          const btnCfg = document.createElement("button");
          btnCfg.type = "button";
          btnCfg.className = "btn-secondary";
          btnCfg.textContent = "Configurar Token HF / Colab";
          btnCfg.onclick = openSettings;

          const colabA = document.createElement("a");
          colabA.className = "btn-secondary";
          colabA.href = COLAB_URL;
          colabA.target = "_blank";
          colabA.rel = "noopener noreferrer";
          colabA.textContent = "Rodar no Google Colab";

          actions.append(btnCfg, colabA);
          errCard.append(errText, actions);
          wrap.appendChild(errCard);
        } else if (msg.streaming && !msg.text && !msg.reasoning) {
          const dots = document.createElement("div");
          dots.className = "typing-dots";
          dots.innerHTML = "<span></span><span></span><span></span>";
          wrap.appendChild(dots);
        } else if (msg.text) {
          const mdDiv = document.createElement("div");
          mdDiv.className = "msg-markdown";
          mdDiv.innerHTML = renderMarkdown(msg.text);
          wrap.appendChild(mdDiv);

          if (!msg.streaming) {
            const actions = document.createElement("div");
            actions.className = "msg-actions";
            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "btn-mini";
            copyBtn.textContent = "Copiar resposta";
            copyBtn.onclick = () => copyText(msg.text, copyBtn);
            actions.appendChild(copyBtn);
            wrap.appendChild(actions);
          }
        }
        row.appendChild(wrap);
      }
      messagesInner.appendChild(row);
    });

    messagesScroll.scrollTop = messagesScroll.scrollHeight;
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = "Copiado!";
      setTimeout(() => { btn.textContent = prev; }, 1400);
    } catch {
      // Fallback ignored
    }
  }

  messagesInner.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy-target]");
    if (!btn) return;
    const target = document.getElementById(btn.getAttribute("data-copy-target"));
    if (target) copyText(target.textContent, btn);
  });

  function buildSystemWithHistory(baseSystem, priorMessages) {
    const clean = priorMessages
      .filter((m) => !m.error && m.text)
      .slice(-8)
      .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text}`)
      .join("\n\n");
    if (!clean) return baseSystem;
    return `${baseSystem}\n\n[Histórico recente desta conversa para manter contexto]\n${clean}`;
  }

  function authHeaders(extra = {}) {
    const headers = { ...extra };
    const tok = (settings.hfToken || "").trim();
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
    return headers;
  }

  async function uploadFilesGradio(baseUrl, files, signal) {
    if (!files.length) return [];
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name || "image.png"));
    const res = await fetch(`${baseUrl}/gradio_api/upload`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
      signal,
    });
    if (!res.ok) throw new Error(`Falha ao enviar imagem (${res.status})`);
    const paths = await res.json();
    return paths.map((p) => ({ path: p, meta: { _type: "gradio.FileData" } }));
  }

  async function streamGradioSSE(baseUrl, endpoint, dataPayload, signal, onData) {
    const initRes = await fetch(`${baseUrl}/gradio_api/call/${endpoint}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ data: dataPayload }),
      signal,
    });
    if (!initRes.ok) {
      const txt = await initRes.text().catch(() => "");
      throw new Error(`Servidor retornou HTTP ${initRes.status}${txt ? ": " + txt.slice(0, 140) : ""}`);
    }
    const { event_id: eventId } = await initRes.json();
    if (!eventId) throw new Error("Resposta inválida ao iniciar fila Gradio.");

    const sseRes = await fetch(`${baseUrl}/gradio_api/call/${endpoint}/${eventId}`, {
      method: "GET",
      headers: authHeaders(),
      signal,
    });
    if (!sseRes.ok || !sseRes.body) {
      throw new Error(`Falha na conexão de streaming (HTTP ${sseRes.status})`);
    }

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let currentEvent = "message";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nlIdx;
      while ((nlIdx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nlIdx).replace(/\r$/, "");
        buf = buf.slice(nlIdx + 1);

        if (line === "") {
          currentEvent = "message";
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }
          if (currentEvent === "error") {
            const msg = (parsed && (parsed.error || parsed.message || parsed.title)) || "Erro na execução da GPU.";
            throw new Error(msg);
          }
          if (currentEvent === "generating" || currentEvent === "complete") {
            onData(parsed);
          }
        }
      }
    }
  }

  function extractTextFromGradioContent(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === "string" ? part : part?.text || ""))
        .join("");
    }
    return "";
  }

  async function runEchotreeLike(baseUrl, text, files, priorMessages, signal, onUpdate) {
    const uploaded = await uploadFilesGradio(baseUrl, files, signal);
    const sys = buildSystemWithHistory(settings.systemPrompt, priorMessages);
    const maxTok = Math.min(8192, Math.max(128, Number(settings.maxTokens) || 2048));
    const temp = Math.min(1.5, Math.max(0, Number(settings.temperature) ?? 0.7));

    const payload = [
      { text, files: uploaded },
      sys,
      maxTok,
      temp,
      0.95,
      40,
      Boolean(settings.thinking),
    ];

    await streamGradioSSE(baseUrl, "respond", payload, signal, (arr) => {
      const msgs = Array.isArray(arr?.[0]) ? arr[0] : [];
      let reasoning = "";
      let answer = "";
      for (const item of msgs) {
        const chunkText = extractTextFromGradioContent(item?.content);
        if (item?.metadata?.title) {
          reasoning += chunkText;
        } else {
          answer += chunkText;
        }
      }
      onUpdate({ text: answer.trimStart(), reasoning: reasoning.trim() });
    });
  }

  async function runJakubicek(text, priorMessages, signal, onUpdate) {
    const sys = buildSystemWithHistory(settings.systemPrompt, priorMessages);
    const maxTok = Math.min(8192, Math.max(256, Number(settings.maxTokens) || 2048));
    const temp = Math.min(1.5, Math.max(0, Number(settings.temperature) ?? 0.6));

    const payload = [text, sys, Boolean(settings.thinking), maxTok, temp];
    await streamGradioSSE(BACKENDS.jakubicek.baseUrl, "chat", payload, signal, (arr) => {
      const out = typeof arr?.[0] === "string" ? arr[0] : "";
      if (out === "💭 Thinking...") {
        onUpdate({ text: "", reasoning: "Raciocinando na GPU A10G..." });
      } else {
        onUpdate({ text: out, reasoning: "" });
      }
    });
  }

  async function runBimapopo(text, priorMessages, signal, onUpdate) {
    const hist = priorMessages
      .filter((m) => !m.error && m.text)
      .slice(-12)
      .map((m) => ({
        role: m.role,
        metadata: null,
        content: [{ text: m.text, type: "text" }],
        options: null,
      }));
    const temp = Math.min(1.5, Math.max(0, Number(settings.temperature) ?? 0.7));
    const maxTok = Math.min(512, Math.max(64, Number(settings.maxTokens) || 512));

    const payload = [text, hist, settings.systemPrompt, temp, maxTok];
    await streamGradioSSE(BACKENDS.bimapopo345.baseUrl, "respond", payload, signal, (arr) => {
      const transcript = Array.isArray(arr?.[0]) ? arr[0] : [];
      const last = transcript[transcript.length - 1];
      if (last && last.role === "assistant") {
        onUpdate({ text: extractTextFromGradioContent(last.content), reasoning: "" });
      }
    });
  }

  async function runCustomColab(baseUrl, text, files, priorMessages, signal, onUpdate) {
    const cleanBase = baseUrl.trim().replace(/\/+$/, "");
    if (!cleanBase) {
      throw new Error("Nenhuma URL do Google Colab configurada nas Configurações.");
    }
    // Probe endpoint schema so both our notebook (/respond) and older (/chat) work
    let epName = "respond";
    try {
      const infoRes = await fetch(`${cleanBase}/gradio_api/info`, { headers: authHeaders(), signal });
      if (infoRes.ok) {
        const info = await infoRes.json();
        const eps = Object.keys(info.named_endpoints || {});
        if (!eps.includes("/respond") && eps.includes("/chat")) epName = "chat";
      }
    } catch {
      // Fallback to /respond
    }

    if (epName === "chat") {
      const sys = buildSystemWithHistory(settings.systemPrompt, priorMessages);
      const maxTok = Math.min(8192, Math.max(256, Number(settings.maxTokens) || 2048));
      const temp = Math.min(1.5, Math.max(0, Number(settings.temperature) ?? 0.6));
      await streamGradioSSE(cleanBase, "chat", [text, sys, Boolean(settings.thinking), maxTok, temp], signal, (arr) => {
        onUpdate({ text: typeof arr?.[0] === "string" ? arr[0] : "", reasoning: "" });
      });
    } else {
      await runEchotreeLike(cleanBase, text, files, priorMessages, signal, onUpdate);
    }
  }

  function resolveCandidateBackends(hasImages) {
    if (settings.backend === "custom") {
      return [{ id: "custom", label: "Colab Customizado" }];
    }
    if (settings.backend !== "auto") {
      const chosen = BACKENDS[settings.backend];
      if (hasImages && !chosen.multimodal) {
        return [BACKENDS.echotree];
      }
      return [chosen];
    }
    if (hasImages) {
      return [BACKENDS.echotree];
    }
    return [BACKENDS.echotree, BACKENDS.jakubicek, BACKENDS.bimapopo345];
  }

  function formatFriendlyError(errMsg) {
    if (/ZeroGPU|quota|limit/i.test(errMsg)) {
      return (
        `**Cota anônima do ZeroGPU atingida neste IP.**\n\n` +
        `Você tem duas soluções rápidas e gratuitas:\n` +
        `1. Abra **Configurações** e cole um **Token Read gratuito do Hugging Face** (aumenta muito o limite diário), **ou**\n` +
        `2. Toque em **Rodar no Google Colab** para iniciar sua própria GPU T4 dedicada em 1 clique e cole o link gerado.`
      );
    }
    return `**Não foi possível obter resposta do servidor GPU.**\n\nDetalhe: \`${errMsg}\``;
  }

  async function sendMessage() {
    if (isGenerating) {
      if (activeAbort) activeAbort.abort();
      return;
    }

    const text = promptInput.value.trim();
    const attached = [...pendingImages];
    if (!text && !attached.length) return;

    const chat = ensureActiveChat();
    const priorMessages = [...chat.messages];

    if (!chat.messages.length && text) {
      chat.title = text.length > 42 ? text.slice(0, 42) + "…" : text;
    }

    chat.messages.push({
      role: "user",
      text,
      images: attached.map((a) => a.dataUrl),
      imageCount: attached.length,
    });

    const assistantMsg = {
      role: "assistant",
      text: "",
      reasoning: "",
      backendName: "",
      streaming: true,
      error: null,
    };
    chat.messages.push(assistantMsg);
    chat.updatedAt = Date.now();

    promptInput.value = "";
    autoResizeTextarea();
    pendingImages = [];
    renderAttachments();
    renderChatList();
    renderMessages();

    isGenerating = true;
    activeAbort = new AbortController();
    updateComposerState();
    updateStatusBadge("busy", "Conectando GPU...");

    const files = attached.map((a) => a.file);
    const candidates = resolveCandidateBackends(files.length > 0);
    let succeeded = false;
    let lastError = null;

    try {
      for (const candidate of candidates) {
        if (activeAbort.signal.aborted) break;
        assistantMsg.backendName = candidate.label;
        updateStatusBadge("busy", candidate.label);
        renderMessages();

        let receivedAny = false;
        const onUpdate = ({ text: t, reasoning: r }) => {
          if (t || r) receivedAny = true;
          if (t !== undefined) assistantMsg.text = t;
          if (r !== undefined) assistantMsg.reasoning = r;
          renderMessages();
        };

        try {
          if (candidate.id === "echotree") {
            await runEchotreeLike(candidate.baseUrl, text, files, priorMessages, activeAbort.signal, onUpdate);
          } else if (candidate.id === "jakubicek") {
            await runJakubicek(text, priorMessages, activeAbort.signal, onUpdate);
          } else if (candidate.id === "bimapopo345") {
            await runBimapopo(text, priorMessages, activeAbort.signal, onUpdate);
          } else if (candidate.id === "custom") {
            await runCustomColab(settings.customUrl, text, files, priorMessages, activeAbort.signal, onUpdate);
          }
          if (!assistantMsg.text && !assistantMsg.reasoning && !receivedAny) {
            throw new Error("O servidor concluiu sem retornar texto.");
          }
          succeeded = true;
          break;
        } catch (err) {
          if (activeAbort.signal.aborted || err.name === "AbortError") {
            break;
          }
          lastError = err;
          if (receivedAny && assistantMsg.text) {
            // Partial response already streamed; keep it
            succeeded = true;
            break;
          }
          assistantMsg.text = "";
          assistantMsg.reasoning = "";
        }
      }

      if (!succeeded && !activeAbort.signal.aborted) {
        assistantMsg.error = formatFriendlyError(lastError?.message || "Erro desconhecido");
        updateStatusBadge("error", "Erro · Ver detalhes");
      } else {
        updateStatusBadge("", null);
      }
    } finally {
      assistantMsg.streaming = false;
      isGenerating = false;
      activeAbort = null;
      saveChats();
      updateComposerState();
      renderMessages();
      if (!assistantMsg.error) updateStatusBadge("", null);
    }
  }

  function autoResizeTextarea() {
    promptInput.style.height = "auto";
    const h = Math.min(promptInput.scrollHeight, 160);
    promptInput.style.height = h + "px";
    promptInput.style.overflowY = promptInput.scrollHeight > 160 ? "auto" : "hidden";
  }

  function openSettings() {
    selectBackend.value = settings.backend;
    inputCustomUrl.value = settings.customUrl || "";
    inputHfToken.value = settings.hfToken || "";
    inputSystem.value = settings.systemPrompt;
    inputMaxTokens.value = settings.maxTokens;
    inputTemp.value = settings.temperature;
    settingsModal.classList.add("open");
  }

  function closeSettings() {
    settingsModal.classList.remove("open");
  }

  // Event bindings
  $("btn-menu").onclick = openSidebar;
  sidebarBackdrop.onclick = closeSidebar;
  $("btn-new-chat").onclick = createNewChat;
  $("btn-settings").onclick = openSettings;
  $("btn-backend-badge").onclick = openSettings;
  $("btn-close-settings").onclick = closeSettings;

  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  inputCustomUrl.addEventListener("input", () => {
    const val = inputCustomUrl.value.trim();
    if (/^https?:\/\/.+/i.test(val)) {
      selectBackend.value = "custom";
    }
  });

  $("btn-test-colab").onclick = async () => {
    const statusEl = $("colab-test-status");
    const url = inputCustomUrl.value.trim().replace(/\/+$/, "");
    if (!url) {
      statusEl.textContent = "Cole primeiro a URL pública https://...gradio.live gerada no Colab.";
      return;
    }
    statusEl.textContent = "Testando conexão com o servidor Colab...";
    try {
      const res = await fetch(`${url}/gradio_api/info`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = await res.json();
      const eps = Object.keys(info.named_endpoints || {});
      if (!eps.length) throw new Error("Nenhum endpoint Gradio ativo.");
      selectBackend.value = "custom";
      statusEl.textContent = `✅ Conectado! Endpoint ativo: ${eps.join(", ")}. Clique em Salvar para usar.`;
    } catch (err) {
      statusEl.textContent = `❌ Não foi possível conectar (${err.message}). Confira se a célula 3 do Colab está rodando.`;
    }
  };

  $("btn-save-settings").onclick = () => {
    settings.backend = selectBackend.value;
    settings.customUrl = inputCustomUrl.value.trim();
    settings.hfToken = inputHfToken.value.trim();
    settings.systemPrompt = inputSystem.value.trim() || DEFAULT_SETTINGS.systemPrompt;
    settings.maxTokens = Math.min(8192, Math.max(256, Number(inputMaxTokens.value) || 2048));
    settings.temperature = Math.min(1.5, Math.max(0, Number(inputTemp.value) ?? 0.7));
    saveSettings();
    updateStatusBadge("", null);
    closeSettings();
  };

  $("btn-reset-settings").onclick = () => {
    const keepTheme = settings.theme;
    settings = { ...DEFAULT_SETTINGS, theme: keepTheme };
    saveSettings();
    openSettings();
    updateStatusBadge("", null);
    updateComposerState();
  };

  $("btn-theme").onclick = () => {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    applyTheme(settings.theme);
    saveSettings();
  };

  btnThinking.onclick = () => {
    settings.thinking = !settings.thinking;
    saveSettings();
    updateComposerState();
  };

  btnAttach.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const files = Array.from(fileInput.files || []).slice(0, 4);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        pendingImages.push({ file, dataUrl: reader.result });
        renderAttachments();
      };
      reader.readAsDataURL(file);
    });
    fileInput.value = "";
  };

  promptInput.addEventListener("input", () => {
    autoResizeTextarea();
    updateComposerState();
  });

  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && window.innerWidth >= 768) {
      e.preventDefault();
      if (!isGenerating) sendMessage();
    }
  });

  composerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });

  // Init
  applyTheme(settings.theme);
  updateStatusBadge("", null);
  updateComposerState();
  if (!chats.length || !getActiveChat()) {
    if (chats.length) activeChatId = chats[0].id;
  }
  renderChatList();
  renderMessages();
})();
