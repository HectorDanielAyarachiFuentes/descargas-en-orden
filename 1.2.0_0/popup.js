// popup.js

/**
 * Aplica las traducciones a la página actual buscando elementos con atributos `data-i18n`.
 */
function applyI18n() {
  // Traduce el título de la página
  const title = document.querySelector('title');
  if (title && title.dataset.i18n) {
    document.title = chrome.i18n.getMessage(title.dataset.i18n);
  }

  // Traduce el contenido de texto de los elementos
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const message = chrome.i18n.getMessage(element.dataset.i18n);
    if (message.includes('<') && message.includes('>')) {
      element.innerHTML = message;
    } else {
      element.textContent = message;
    }
  });

  // Traduce atributos comunes como 'placeholder' y 'title'
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.placeholder = chrome.i18n.getMessage(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    element.title = chrome.i18n.getMessage(element.dataset.i18nTitle);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  applyI18n(); // <-- Llama a la función de traducción

  // --- Elementos de la UI ---
  const openOptionsBtn = document.getElementById("openOptions");
  const autoOrganizeToggle = document.getElementById("autoOrganizeToggle");
  const forceFolderInput = document.getElementById("forceFolderInput");
  const forceNextDownloadBtn = document.getElementById("forceNextDownloadBtn");
  const cancelForceBtn = document.getElementById("cancelForceBtn");
  
  // --- Carga de estado y datos iniciales ---
  loadAppSettings();
  loadHistory();
  loadFolderSuggestions();

  // Cargar el script del gestor de temas
const themeScript = document.createElement('script');
themeScript.src = 'theme-manager.js';
document.head.appendChild(themeScript);

themeScript.onload = () => {
  initTheme();
};

  // --- Listeners de eventos ---
  openOptionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  autoOrganizeToggle.addEventListener("change", (e) => {
    chrome.storage.sync.set({ autoOrganize: e.target.checked });
  });

  forceNextDownloadBtn.addEventListener("click", activateForceMode);
  cancelForceBtn.addEventListener("click", deactivateForceMode);
});

async function loadAppSettings() {
  const { autoOrganize = true } = await chrome.storage.sync.get("autoOrganize");
  document.getElementById("autoOrganizeToggle").checked = autoOrganize;

  const { forceNextDownload } = await chrome.storage.local.get("forceNextDownload");
  if (forceNextDownload && forceNextDownload.folder) {
    showActiveForceView(forceNextDownload.folder);
  }
}

function activateForceMode() {
  const folder = document.getElementById("forceFolderInput").value.trim();
  if (!folder) return;

  const forceRule = { folder: folder };
  chrome.storage.local.set({ forceNextDownload: forceRule }, () => {
    chrome.action.setBadgeText({ text: '1' });
    chrome.action.setBadgeBackgroundColor({ color: '#007bff' });
    showActiveForceView(folder);
  });
}

function deactivateForceMode() {
  chrome.storage.local.remove("forceNextDownload", () => {
    chrome.action.setBadgeText({ text: '' });
    showIdleForceView();
  });
}

function showActiveForceView(folder) {
  document.getElementById("force-idle-view").style.display = "none";
  const activeView = document.getElementById("force-active-view");
  // Usamos getMessage con un marcador de posición
  activeView.querySelector(".force-active-text").innerHTML = chrome.i18n.getMessage("popup_forceActiveText", folder);
  activeView.style.display = "block";
}

function showIdleForceView() {
  document.getElementById("force-active-view").style.display = "none";
  document.getElementById("force-idle-view").style.display = "block";
  document.getElementById("forceFolderInput").value = "";
}

async function loadFolderSuggestions() {
  const { customRules = [] } = await chrome.storage.sync.get("customRules");
  const uniqueFolders = [...new Set(customRules.map(rule => rule.folder))];
  
  const suggestionsDatalist = document.getElementById("folder-suggestions");
  if (!suggestionsDatalist) return;
  
  suggestionsDatalist.innerHTML = "";
  uniqueFolders.forEach(folder => {
    const option = document.createElement("option");
    option.value = folder;
    suggestionsDatalist.appendChild(option);
  });
}

function getFileTypeIcon(filename) {
  const ext = (filename.split('.').pop() || "").toLowerCase();
  const fileIcons = {
    pdf: '📄', doc: '📄', docx: '📄', odt: '📄',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
    mp4: '🎬', mkv: '🎬', avi: '🎬', webm: '🎬',
    mp3: '🎵', wav: '🎵', ogg: '🎵',
    zip: '📦', rar: '📦', '7z': '📦',
    xls: '📊', xlsx: '📊', csv: '📊',
    exe: '⚙️', msi: '⚙️',
    default: '📁'
  };
  return fileIcons[ext] || fileIcons.default;
}

function loadHistory() {
  chrome.storage.local.get({ downloadHistory: [] }, (result) => {
    const historyList = document.getElementById("popupHistory");
    const downloadCountElem = document.getElementById("downloadCount");
    const totalDownloads = result.downloadHistory.length;

    if (!historyList || !downloadCountElem) return;

    // Usamos getMessage con un marcador de posición
    downloadCountElem.textContent = chrome.i18n.getMessage("popup_downloadCount", String(totalDownloads));
    historyList.innerHTML = "";

    if (totalDownloads === 0) {
      // Usamos getMessage para el texto
      historyList.innerHTML = `<li>${chrome.i18n.getMessage("popup_noHistory")}</li>`;
      return;
    }
    
    const lastDownloads = result.downloadHistory.slice(-5).reverse();
    lastDownloads.forEach(entry => {
        const listItem = document.createElement("li");
        
        listItem.innerHTML = `
          <div class="history-item-icon">${getFileTypeIcon(entry.filename)}</div>
          <div class="history-item-details">
            <strong>${entry.filename}</strong>
            <small>${new Date(entry.date).toLocaleString([], {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})} → 📂 ${entry.folder}</small>
          </div>
          <div class="popup-history-actions"></div>
        `;
        
        const actionsContainer = listItem.querySelector(".popup-history-actions");

        if (entry.id !== undefined) {
            const openFolderBtn = document.createElement("button");
            openFolderBtn.textContent = chrome.i18n.getMessage("openFolderButton");
            openFolderBtn.title = chrome.i18n.getMessage("openFolderTooltip");
            openFolderBtn.addEventListener("click", () => openFolderInExplorer(entry.id));
            actionsContainer.appendChild(openFolderBtn);
        }
        if (entry.url) {
            const reDownloadBtn = document.createElement("button");
            reDownloadBtn.textContent = chrome.i18n.getMessage("redownloadButton");
            reDownloadBtn.title = chrome.i18n.getMessage("redownloadTooltip");
            reDownloadBtn.addEventListener("click", () => chrome.downloads.download({ url: entry.url }));
            actionsContainer.appendChild(reDownloadBtn);
        }
        
        historyList.appendChild(listItem);
    });
  });
}

function openFolderInExplorer(downloadId) {
    const numId = Number(downloadId);
    if (isNaN(numId)) return;

    chrome.downloads.search({ id: numId }, (results) => {
        if (chrome.runtime.lastError) {
            showFeedback(chrome.i18n.getMessage("feedback_errorFindDownload"), false);
            return;
        }
        if (!results || !results.length) {
            showFeedback(chrome.i18n.getMessage("feedback_errorNotInHistory"), false);
            return;
        }
        if (!results[0].exists) {
            showFeedback(chrome.i18n.getMessage("feedback_errorFileNotExists"), false);
            return;
        }
        chrome.downloads.show(numId);
    });
}

function showFeedback(message, success = true) {
  let feedbackContainer = document.getElementById("popupFeedbackToast");
  if (!feedbackContainer) {
    feedbackContainer = document.createElement("div");
    feedbackContainer.id = "popupFeedbackToast";
    document.body.appendChild(feedbackContainer);
  }

  feedbackContainer.textContent = message;
  feedbackContainer.className = "popup-feedback-toast";
  feedbackContainer.classList.add(success ? "success" : "error");
  
  void feedbackContainer.offsetWidth;

  feedbackContainer.classList.add("visible");

  setTimeout(() => {
    feedbackContainer.classList.remove("visible");
  }, 3000);
}