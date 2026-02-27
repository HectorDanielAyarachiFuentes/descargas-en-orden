// options.js

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
    if (element.dataset.i18n === "footerText") {
      const currentYear = new Date().getFullYear();
      element.innerHTML = message.replace('2025', currentYear);
    } else if (message.includes('<') && message.includes('>')) {
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


// =====================
// Variables globales
// =====================
let fullHistory = [];
let renamePatternComponents = [];
let editingRuleId = null; // Para saber qué regla estamos editando

// Estado global del widget
let widgetState = {
  currentTab: 'visible', // 'visible' o 'hidden'
  ignoredFolders: JSON.parse(localStorage.getItem("ignoredFolders")) || [],
  historyCache: [] // Cacheamos el historial para no pedirlo a cada click
};

// =====================
// DOMContentLoaded
// =====================
document.addEventListener("DOMContentLoaded", () => {
  applyI18n(); // <-- Llama a la función de traducción

  // Carga inicial
  loadSettings();
  updateHistory();
  loadCustomRules();

  // Listeners para autoguardado de ajustes generales
  document.getElementById("autoOrganize").addEventListener("change", (e) => saveSingleSetting('autoOrganize', e.target.checked));
  document.getElementById("contextMenu").addEventListener("change", (e) => saveSingleSetting('contextMenu', e.target.checked));
  document.getElementById("notifications").addEventListener("change", (e) => saveSingleSetting('notifications', e.target.value));

  // --- NUEVO: Listeners para categorías por defecto ---
  const catIds = ['cat_pdf', 'cat_images', 'cat_video', 'cat_audio', 'cat_compressed', 'cat_documents', 'cat_programs'];
  catIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveDefaultCategories);
  });

  // Listeners Generales
  document.getElementById("clearHistory").addEventListener("click", clearHistory);
  document.getElementById("addRuleBtn").addEventListener("click", addRule);
  document.getElementById("updateRuleBtn").addEventListener("click", updateRule);
  document.getElementById("cancelEditBtn").addEventListener("click", exitEditMode);
  document.getElementById("exportRulesBtn").addEventListener("click", exportRules);
  document.getElementById("importRulesBtn").addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change", importRules);
  document.getElementById("searchHistory").addEventListener("input", (e) => filterHistory(e.target.value.toLowerCase()));

  // Listener para mostrar feedback desde otros scripts (como popup.js)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "showFeedback") {
      showStatus(request.message, request.success ? 'success' : 'error');
    }
  });

  // Listeners para constructores y elementos dinámicos
  setupDateFormatModal();
  setupRenameBuilder();
  setupDynamicPlaceholders();
  setupOnDemandOrganizer();

  renderPatternPreview();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.customRules) loadCustomRules();
      if (changes.autoOrganize || changes.contextMenu || changes.notifications) loadSettings();
    }
    if (changes.downloadHistory) {
      updateHistory();
    }
  });
  initDraggableWidget();
  initSmartWidget();
});

function initSmartWidget() {
  const widget = document.getElementById("floating-widget");
  if (!widget) return;

  // Inicializar Arrastre (Reutilizamos la función initDraggableWidget que ya tienes)
  initDraggableWidget();

  // --- CORRECCIÓN: Lógica para Colapsar/Expandir ---
  const collapseBtn = document.getElementById("widget-collapse-btn");
  if (collapseBtn) {
    collapseBtn.addEventListener("click", (e) => {
      // Detenemos la propagación para que no intente arrastrar el widget al hacer click
      e.stopPropagation();
      widget.classList.toggle("collapsed");
    });
  }

  // Listeners de Pestañas
  const tabVisible = document.getElementById("tab-visible");
  const tabHidden = document.getElementById("tab-hidden");

  if (tabVisible) tabVisible.addEventListener("click", () => switchTab('visible'));
  if (tabHidden) tabHidden.addEventListener("click", () => switchTab('hidden'));

  // Cargar historial y renderizar
  refreshWidgetData();

  // Escuchar cambios en descargas para actualizar en tiempo real
  chrome.downloads.onCreated.addListener(() => setTimeout(refreshWidgetData, 1000));
  chrome.downloads.onChanged.addListener(() => setTimeout(refreshWidgetData, 1000));
}

function switchTab(tab) {
  widgetState.currentTab = tab;

  // Actualizar UI de pestañas
  document.getElementById("tab-visible").classList.toggle("active", tab === 'visible');
  document.getElementById("tab-hidden").classList.toggle("active", tab === 'hidden');

  renderSmartGrid();
}

function refreshWidgetData() {
  chrome.storage.local.get({ downloadHistory: [] }, (result) => {
    widgetState.historyCache = result.downloadHistory || [];
    renderSmartGrid();
  });
}

function renderSmartGrid() {
  const container = document.getElementById("widget-folders-grid");
  container.innerHTML = "";

  // 1. Obtener todas las carpetas únicas del historial
  const uniqueFolders = [...new Set(widgetState.historyCache.map(item => item.folder))].filter(Boolean);

  // 2. Filtrar según la pestaña activa
  const foldersToShow = uniqueFolders.filter(folder => {
    const isIgnored = widgetState.ignoredFolders.includes(folder);
    return widgetState.currentTab === 'visible' ? !isIgnored : isIgnored;
  }).sort();

  // 3. Renderizar mensajes vacíos
  if (foldersToShow.length === 0) {
    const msg = widgetState.currentTab === 'visible'
      ? chrome.i18n.getMessage("widgetMsgNoActive")
      : chrome.i18n.getMessage("widgetMsgTrashEmpty");
    container.innerHTML = `<div style='grid-column:1/-1; text-align:center; color:var(--text-secondary); font-size:0.75rem; padding:15px;'>${msg}</div>`;
    return;
  }

  // 4. Renderizar Carpetas
  foldersToShow.forEach(folderName => {
    const div = document.createElement("div");
    div.className = "win-item";
    div.title = `Abrir: ${folderName}`;

    // --- Lógica de Botones ---
    // Pestaña Visible: Botón Rojo (Ocultar) a la derecha.
    // Pestaña Ocultos: Botón Verde (Restaurar) a la derecha + Botón Papelera (Borrar) a la izquierda.

    const rightBtnClass = widgetState.currentTab === 'visible' ? 'btn-hide' : 'btn-show';
    const rightBtnIcon = widgetState.currentTab === 'visible' ? '✖' : '＋';
    const rightBtnTitle = widgetState.currentTab === 'visible' ? chrome.i18n.getMessage("widgetBtnMoveHidden") : chrome.i18n.getMessage("widgetBtnRestore");

    let htmlContent = `
            <button class="action-folder-btn ${rightBtnClass}" title="${rightBtnTitle}">${rightBtnIcon}</button>
            <div class="win-icon" style="color: #fdd835;">📁</div>
            <div class="win-label">${truncateName(folderName, 12)}</div>
        `;

    // Si estamos en Ocultos, añadimos el botón de "Eliminar para siempre"
    if (widgetState.currentTab === 'hidden') {
      const tooltip = chrome.i18n.getMessage("widgetBtnForget");
      htmlContent += `<button class="delete-forever-btn" title="${tooltip}">🗑️</button>`;
    }

    div.innerHTML = htmlContent;

    // --- Event Listeners ---

    // 1. Click en la Carpeta (Abrir)
    div.addEventListener("click", (e) => {
      if (e.target.tagName === 'BUTTON') return;
      openResilientFolder(folderName);
    });

    // 2. Click en Botón Derecho (Ocultar / Restaurar)
    div.querySelector('.action-folder-btn').addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolderVisibility(folderName);
    });

    // 3. Click en Botón Izquierdo (Borrar Definitivamente) - Solo en tab ocultos
    const deleteBtn = div.querySelector('.delete-forever-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(chrome.i18n.getMessage("widgetConfirmForget", folderName))) {
          forgetFolderForever(folderName);
        }
      });
    }

    container.appendChild(div);
  });
}

// --- NUEVA FUNCIÓN: Olvido Total ---
function forgetFolderForever(folderName) {
  chrome.storage.local.get({ downloadHistory: [] }, (result) => {
    let history = result.downloadHistory;

    // 1. Filtramos para quitar TODO lo relacionado con esa carpeta
    const newHistory = history.filter(item => item.folder !== folderName);

    // 2. Guardamos el historial limpio
    chrome.storage.local.set({ downloadHistory: newHistory }, () => {
      // 3. Limpiamos también de la lista de ignorados para no dejar basura
      widgetState.ignoredFolders = widgetState.ignoredFolders.filter(f => f !== folderName);
      localStorage.setItem("ignoredFolders", JSON.stringify(widgetState.ignoredFolders));

      // 4. Actualizamos la caché y la vista
      widgetState.historyCache = newHistory;
      renderSmartGrid();
    });
  });
}

function toggleFolderVisibility(folderName) {
  if (widgetState.ignoredFolders.includes(folderName)) {
    // Restaurar
    widgetState.ignoredFolders = widgetState.ignoredFolders.filter(f => f !== folderName);
  } else {
    // Ocultar
    widgetState.ignoredFolders.push(folderName);
  }
  localStorage.setItem("ignoredFolders", JSON.stringify(widgetState.ignoredFolders));

  // Pequeña animación visual antes de re-renderizar
  renderSmartGrid();
}

// --- EL NÚCLEO DE LA MAGIA: APERTURA RESILIENTE ---
async function openResilientFolder(folderName) {
  // 1. Filtramos TODOS los archivos que pertenecen a esa carpeta
  const filesInFolder = widgetState.historyCache.filter(item => item.folder === folderName).reverse(); // Del más nuevo al viejo

  if (filesInFolder.length === 0) {
    alert(chrome.i18n.getMessage("widgetAlertNoFiles"));
    return;
  }

  // 2. Buscamos uno por uno hasta encontrar uno que exista en disco
  let opened = false;

  // Mostramos feedback visual (cursor de espera)
  document.body.style.cursor = 'wait';

  for (const file of filesInFolder) {
    if (!file.id) continue;

    // Usamos una Promesa para verificar existencia
    const exists = await checkFileExists(file.id);

    if (exists) {
      chrome.downloads.show(file.id);
      opened = true;
      break; // ¡Éxito! Salimos del bucle
    }
  }

  document.body.style.cursor = 'default';

  if (!opened) {
    // Si llegamos aquí, revisamos TODOS los archivos del historial para esta carpeta y NINGUNO existe en disco.
    if (confirm(chrome.i18n.getMessage("widgetConfirmGhost", folderName))) {
      toggleFolderVisibility(folderName);
    }
  }
}

// Helper para verificar existencia (promisified)
function checkFileExists(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.search({ id: downloadId }, (results) => {
      if (chrome.runtime.lastError || !results || !results.length) {
        resolve(false);
      } else {
        resolve(results[0].exists);
      }
    });
  });
}

function initDraggableWidget() {
  const widget = document.getElementById("floating-widget");
  const handle = document.getElementById("widget-drag-handle");
  const collapseBtn = document.getElementById("widget-collapse-btn");
  const contentGrid = document.getElementById("widget-folders-grid");

  if (!widget || !handle) return;

  // --- 1. Cargar posición guardada ---
  const savedPos = JSON.parse(localStorage.getItem("widgetPosition"));
  if (savedPos) {
    widget.style.top = savedPos.top;
    widget.style.left = savedPos.left;
    // Si teníamos guardado 'right', lo limpiamos para que mande 'left'
    widget.style.right = 'auto';
  }

  // --- 2. Lógica de Arrastre ---
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  handle.addEventListener("mousedown", (e) => {
    // Evitamos arrastrar si se hizo clic en el botón de colapsar
    if (e.target === collapseBtn) return;

    isDragging = true;

    // Posición inicial del ratón
    startX = e.clientX;
    startY = e.clientY;

    // Posición inicial del widget
    const rect = widget.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    // Añadimos listeners globales temporalmente
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    e.preventDefault(); // Evitar selección de texto

    // Calcular desplazamiento
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // Nueva posición
    widget.style.left = `${initialLeft + dx}px`;
    widget.style.top = `${initialTop + dy}px`;
    widget.style.right = "auto"; // Importante desactivar right
    widget.style.bottom = "auto"; // Importante desactivar bottom
  }

  function onMouseUp() {
    if (isDragging) {
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      // Guardar posición final en localStorage
      localStorage.setItem("widgetPosition", JSON.stringify({
        top: widget.style.top,
        left: widget.style.left
      }));
    }
  }

  // --- 3. Lógica de Colapsar ---
  collapseBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // Evitar conflictos
    widget.classList.toggle("collapsed");
  });

  // --- 4. Renderizar Contenido (Carpetas) ---
  renderWidgetContent(contentGrid);
}

// --- Variable para almacenar carpetas ignoradas ---
let ignoredFolders = JSON.parse(localStorage.getItem("ignoredFolders")) || [];

function renderWidgetContent(container) {
  chrome.storage.local.get({ downloadHistory: [] }, (result) => {
    const history = result.downloadHistory;
    container.innerHTML = "";

    if (!history || history.length === 0) {
      container.innerHTML = `<div style='grid-column:1/-1; text-align:center; color:var(--text-secondary); font-size:0.8rem; padding:10px;'>${chrome.i18n.getMessage("widgetMsgNoActive")}</div>`;
      return;
    }

    // 1. Agrupar carpetas únicas
    const folderMap = {};

    // Recorremos el historial (del más reciente al más antiguo)
    [...history].reverse().forEach(item => {
      // Solo si tiene carpeta, ID y NO está en la lista de ignorados
      if (item.folder && item.id && !folderMap[item.folder] && !ignoredFolders.includes(item.folder)) {
        folderMap[item.folder] = item.id;
      }
    });

    const sortedFolders = Object.keys(folderMap).sort();

    if (sortedFolders.length === 0) {
      container.innerHTML = `<div style='grid-column:1/-1; text-align:center; color:var(--text-secondary); font-size:0.8rem; padding:10px;'>${chrome.i18n.getMessage("msgFoldersHiddenOrEmpty")}</div>`;
      // Opcional: Botón para resetear filtros
      const resetBtn = document.createElement("button");
      resetBtn.textContent = chrome.i18n.getMessage("btnResetHidden");
      resetBtn.className = "btn-secondary"; // Asegúrate de tener esta clase o usa estilos inline
      resetBtn.style.cssText = "font-size: 0.7rem; margin: 5px auto; display: block;";
      resetBtn.onclick = () => {
        ignoredFolders = [];
        localStorage.setItem("ignoredFolders", JSON.stringify(ignoredFolders));
        renderWidgetContent(container);
      };
      container.appendChild(resetBtn);
      return;
    }

    sortedFolders.forEach(folderName => {
      const downloadId = folderMap[folderName];

      const div = document.createElement("div");
      div.className = "win-item";
      div.title = `Abrir: ${folderName}`;

      // Estructura HTML con el botón de borrar
      div.innerHTML = `
                <button class="remove-folder-btn" title="Ocultar carpeta">✖</button>
                <div class="win-icon" style="color: #fdd835;">📁</div>
                <div class="win-label">${truncateName(folderName, 12)}</div>
            `;

      // Evento: Abrir Carpeta (Click en el div)
      div.addEventListener("click", (e) => {
        // Si hizo clic en el botón de borrar, no abrimos la carpeta
        if (e.target.classList.contains('remove-folder-btn')) return;

        openFolderInExplorerSmart(downloadId, folderName, container);
      });

      // Evento: Borrar Carpeta (Click en la X)
      const closeBtn = div.querySelector('.remove-folder-btn');
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Detener propagación
        hideFolder(folderName, container);
      });

      container.appendChild(div);
    });
  });
}

// --- Nueva Función para Ocultar Carpeta ---
function hideFolder(folderName, container) {
  if (!ignoredFolders.includes(folderName)) {
    ignoredFolders.push(folderName);
    localStorage.setItem("ignoredFolders", JSON.stringify(ignoredFolders));
    renderWidgetContent(container); // Re-renderizar
  }
}

// --- Nueva Función "Inteligente" para abrir carpetas ---
// Reemplaza el uso directo de openFolderInExplorer en el widget
function openFolderInExplorerSmart(downloadId, folderName, container) {
  const numId = Number(downloadId);

  chrome.downloads.search({ id: numId }, (results) => {
    // 1. Verificar errores de Chrome
    if (chrome.runtime.lastError) {
      console.log("Error buscando descarga:", chrome.runtime.lastError);
      return;
    }

    // 2. Verificar si el archivo existe físicamente
    if (!results || !results.length || !results[0].exists) {
      // EL ARCHIVO YA NO EXISTE
      const confirmHide = confirm(chrome.i18n.getMessage("widgetConfirmLostFile", folderName));

      if (confirmHide) {
        hideFolder(folderName, container);
      }
      return;
    }

    // 3. Si todo está bien, abrir carpeta
    chrome.downloads.show(numId);
  });
}

function truncateName(str, max) {
  if (str.length > max) return str.substring(0, max - 2) + "..";
  return str;
}

// Cargar el script del gestor de temas
const themeScript = document.createElement('script');
themeScript.src = 'theme-manager.js';
document.head.appendChild(themeScript);

// Inicializar tema al cargar
themeScript.onload = () => {
  initTheme();
  loadThemeSelector();
};

// Configurar el selector de tema
function loadThemeSelector() {
  const themeButtons = document.querySelectorAll('.theme-btn');

  chrome.storage.sync.get({ theme: 'auto' }, (data) => {
    themeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === data.theme);
    });
  });

  themeButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const newTheme = btn.dataset.theme;
      await setThemePreference(newTheme);

      themeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      showStatus(chrome.i18n.getMessage("statusThemeChanged"), "success");
    });
  });
}

function setupDynamicPlaceholders() {
  const ruleTypeSelect = document.getElementById("ruleType");
  const ruleValueInput = document.getElementById("ruleValue");

  if (!ruleTypeSelect || !ruleValueInput) return;

  ruleTypeSelect.addEventListener("change", () => {
    const selectedType = ruleTypeSelect.value;
    if (selectedType === "keyword") {
      ruleValueInput.placeholder = chrome.i18n.getMessage("ruleValuePlaceholder");
    } else if (selectedType === "url") {
      ruleValueInput.placeholder = chrome.i18n.getMessage("placeholder_urlExample");
    }
  });
}

// ===============================================
// LÓGICA DEL MODO DE EDICIÓN
// ===============================================

async function enterEditMode(ruleId) {
  const { customRules = [] } = await chrome.storage.sync.get('customRules');
  const ruleToEdit = customRules.find(r => r.id === ruleId);
  if (!ruleToEdit) {
    showStatus(chrome.i18n.getMessage("feedback_errorRuleNotFound"), "error");
    return;
  }

  editingRuleId = ruleId;

  document.getElementById("ruleType").value = ruleToEdit.type;
  document.getElementById("ruleValue").value = ruleToEdit.value;
  document.getElementById("ruleFolder").value = ruleToEdit.folder;

  renamePatternComponents = parseRenamePattern(ruleToEdit.renamePattern || "");
  renderPatternPreview();

  document.getElementById("rule-form-title").textContent = chrome.i18n.getMessage("title_editingRule");
  document.getElementById("addRuleBtn").style.display = "none";
  document.getElementById("updateRuleBtn").style.display = "inline-block";
  document.getElementById("cancelEditBtn").style.display = "inline-block";

  document.getElementById("rule-form-section").scrollIntoView({ behavior: 'smooth' });
}

function exitEditMode() {
  editingRuleId = null;

  document.getElementById("ruleType").value = "keyword";
  document.getElementById("ruleValue").value = "";
  document.getElementById("ruleFolder").value = "";
  clearRenameBuilder();

  document.getElementById("rule-form-title").textContent = chrome.i18n.getMessage("newCustomRuleTitle");
  document.getElementById("addRuleBtn").style.display = "inline-block";
  document.getElementById("updateRuleBtn").style.display = "none";
  document.getElementById("cancelEditBtn").style.display = "none";
}

// ===============================================
// LÓGICA PARA EL CONSTRUCTOR DE RENOMBRADO
// ===============================================

function parseRenamePattern(pattern) {
  if (!pattern) return [];

  const components = [];
  const regex = /(\[sitio\]|\[nombre_original\]|\[fecha:[^\]]+\])/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(pattern)) !== null) {
    if (match.index > lastIndex) {
      const text = pattern.substring(lastIndex, match.index);
      components.push(createComponent('text', text));
    }

    const token = match[0];
    if (token.startsWith('[fecha:')) {
      const format = token.substring(7, token.length - 1);
      components.push(createComponent('fecha', format));
    } else if (token === '[sitio]') {
      components.push(createComponent('sitio', '[sitio]'));
    } else if (token === '[nombre_original]') {
      components.push(createComponent('nombre_original', '[nombre_original]'));
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < pattern.length) {
    const text = pattern.substring(lastIndex);
    components.push(createComponent('text', text));
  }

  return components;
}

function setupRenameBuilder() {
  const previewContainer = document.getElementById("rename-pattern-preview");
  const pillsContainer = document.getElementById("rename-pills-container");

  if (!previewContainer || !pillsContainer) return;

  new Sortable(previewContainer, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: () => {
      const newOrder = [];
      previewContainer.querySelectorAll('.pattern-component').forEach(el => {
        newOrder.push(renamePatternComponents.find(c => c.id === el.id));
      });
      renamePatternComponents = newOrder;
    }
  });

  pillsContainer.addEventListener("click", (event) => {
    const button = event.target.closest(".variable-pill");
    if (!button || button.id === 'add-date-format-btn') return;

    const type = button.dataset.type;
    let component;
    switch (type) {
      case 'text':
        const text = prompt(chrome.i18n.getMessage("prompt_enterFreeText"), "_");
        if (text) component = createComponent('text', text);
        break;
      case 'sitio':
        component = createComponent('sitio', '[sitio]');
        break;
      case 'nombre_original':
        component = createComponent('nombre_original', '[nombre_original]');
        break;
    }
    if (component) addComponentToBuilder(component);
  });

  previewContainer.addEventListener("click", (event) => {
    if (event.target.classList.contains("remove-component-btn")) {
      const componentElement = event.target.parentElement;
      const componentId = componentElement.id;
      renamePatternComponents = renamePatternComponents.filter(c => c.id !== componentId);
      renderPatternPreview();
    }
  });
}

function createComponent(type, value) {
  return { id: `comp_${Date.now()}_${Math.random()}`, type, value };
}

function addComponentToBuilder(component) {
  renamePatternComponents.push(component);
  renderPatternPreview();
}

// options.js (RECOMENDADO)

/**
 * Renderiza la vista previa del patrón de renombrado.
 * Muestra un texto de marcador de posición si no hay componentes,
 * o la lista de componentes si existen.
 */
function renderPatternPreview() {
  // 1. Obtener el contenedor de la vista previa del DOM.
  const previewContainer = document.getElementById("rename-pattern-preview");

  // 2. Limpiar CUALQUIER contenido previo (componentes o el texto de marcador de posición).
  previewContainer.innerHTML = "";

  // 3. Resetear el estado visual eliminando la clase de marcador de posición.
  previewContainer.classList.remove('is-empty');

  // 4. Comprobar si hay componentes para mostrar.
  if (renamePatternComponents.length === 0) {
    // --- CASO: NO HAY COMPONENTES ---
    // a. Obtener el texto traducido desde los archivos messages.json.
    const placeholderText = chrome.i18n.getMessage("renamePreviewPlaceholder");

    // b. Insertar el texto en el contenedor.
    previewContainer.textContent = placeholderText;

    // c. Añadir la clase CSS para aplicar los estilos de texto (cursiva, color, centrado, etc.).
    previewContainer.classList.add('is-empty');

  } else {
    // --- CASO: SÍ HAY COMPONENTES ---
    // a. Recorrer el array de componentes y crear un elemento para cada uno.
    renamePatternComponents.forEach(component => {
      const el = document.createElement("div");
      el.className = "pattern-component";
      el.id = component.id;
      el.dataset.type = component.type;

      // b. Determinar el texto a mostrar para cada tipo de componente.
      let displayValue = component.value;
      if (component.type === 'fecha') {
        displayValue = chrome.i18n.getMessage("label_dateComponent", component.value);
      } else if (component.type === 'sitio') {
        displayValue = chrome.i18n.getMessage("addSiteComponent").replace('+', '').trim();
      } else if (component.type === 'nombre_original') {
        displayValue = chrome.i18n.getMessage("addOriginalNameComponent").replace('+', '').trim();
      }

      // c. Crear el HTML interno del componente, incluyendo el botón de eliminar.
      const removeButtonTitle = chrome.i18n.getMessage("tooltip_removeComponent");
      el.innerHTML = `<span>${displayValue}</span><button type="button" class="remove-component-btn" title="${removeButtonTitle}">✖</button>`;

      // d. Añadir el componente recién creado al contenedor de la vista previa.
      previewContainer.appendChild(el);
    });
  }
}

function getRenamePatternString() {
  return renamePatternComponents.map(c => {
    if (c.type === 'fecha') return `[fecha:${c.value}]`;
    if (c.type === 'sitio' || c.type === 'nombre_original') return c.value;
    return c.value;
  }).join('');
}

function clearRenameBuilder() {
  renamePatternComponents = [];
  renderPatternPreview();
}

function setupDateFormatModal() {
  const modal = document.getElementById("date-format-modal");
  const openBtn = document.getElementById("add-date-format-btn");
  const cancelBtn = document.getElementById("cancel-format-btn");
  const insertBtn = document.getElementById("insert-format-btn");
  const customFormatInput = document.getElementById("custom-format-input");
  const previewText = document.getElementById("format-preview-text");
  const formatBuilder = document.querySelector(".format-builder");

  const updatePreview = () => {
    const format = customFormatInput.value;
    if (!format) {
      previewText.textContent = "";
      return;
    }
    previewText.textContent = formatDate(new Date(), format);
  };

  if (!openBtn) return;

  openBtn.addEventListener("click", () => {
    customFormatInput.value = "YYYY-MM-DD";
    updatePreview();
    modal.style.display = "flex";
  });

  const closeModal = () => {
    modal.style.display = "none";
  };
  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  formatBuilder.addEventListener("click", (event) => {
    const target = event.target;
    if (target.classList.contains("preset-pill")) {
      customFormatInput.value = target.dataset.format;
    } else if (target.classList.contains("format-code-pill")) {
      insertTextAtCursor(customFormatInput, target.dataset.code);
    }
    updatePreview();
  });

  customFormatInput.addEventListener("input", updatePreview);

  insertBtn.addEventListener("click", () => {
    const format = customFormatInput.value;
    if (format) {
      addComponentToBuilder(createComponent('fecha', format));
    }
    closeModal();
  });
}

function insertTextAtCursor(inputElement, text) {
  const startPos = inputElement.selectionStart;
  const endPos = inputElement.selectionEnd;
  const currentValue = inputElement.value;
  inputElement.value = currentValue.substring(0, startPos) + text + currentValue.substring(endPos);
  inputElement.focus();
  const newCursorPos = startPos + text.length;
  inputElement.setSelectionRange(newCursorPos, newCursorPos);
}

function formatDate(date, format) {
  const map = {
    YYYY: date.getFullYear(),
    YY: String(date.getFullYear()).slice(-2),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    DD: String(date.getDate()).padStart(2, '0'),
    hh: String(date.getHours()).padStart(2, '0'),
    mm: String(date.getMinutes()).padStart(2, '0'),
    ss: String(date.getSeconds()).padStart(2, '0'),
  };
  return format.replace(/YYYY|YY|MM|DD|hh|mm|ss/g, match => map[match]);
}

// ===================================================
// FUNCIONES CRUD PARA REGLAS Y OTROS
// ===================================================

function loadSettings() {
  chrome.storage.sync.get({
    autoOrganize: true,
    notifications: 'always',
    contextMenu: true,
    // Defaults: Todos activos
    defaultCategories: {
      pdf: true, images: true, video: true, audio: true,
      compressed: true, documents: true, programs: true
    }
  }, (data) => {
    document.getElementById("autoOrganize").checked = data.autoOrganize;
    document.getElementById("notifications").value = data.notifications;
    document.getElementById("contextMenu").checked = data.contextMenu;

    // Cargar estado de los checkboxes de categorías
    const cats = data.defaultCategories;
    if (cats) {
      document.getElementById("cat_pdf").checked = cats.pdf !== false;
      document.getElementById("cat_images").checked = cats.images !== false;
      document.getElementById("cat_video").checked = cats.video !== false;
      document.getElementById("cat_audio").checked = cats.audio !== false;
      document.getElementById("cat_compressed").checked = cats.compressed !== false;
      document.getElementById("cat_documents").checked = cats.documents !== false;
      document.getElementById("cat_programs").checked = cats.programs !== false;
    }
  });
}

function saveSingleSetting(key, value) {
  chrome.storage.sync.set({ [key]: value }, () => {
    showStatus(chrome.i18n.getMessage("statusSettingsSaved"), "success");
  });
}

// --- FUNCIÓN CORREGIDA ---
function loadCustomRules() {
  chrome.storage.sync.get({ customRules: [] }, (data) => {
    let rules = data.customRules;
    let migrationNeeded = false;

    // 1. Revisa si hay reglas viejas sin ID
    rules.forEach(rule => {
      if (!rule.id) {
        rule.id = `rule_${Date.now()}_${Math.random()}`;
        migrationNeeded = true;
      }
    });

    // 2. Si se hizo algún cambio, guarda la lista actualizada
    if (migrationNeeded) {
      chrome.storage.sync.set({ customRules: rules }, () => {
        console.log("Migración de reglas completada: Se añadieron IDs a reglas antiguas.");
        renderRulesList(rules);
      });
    } else {
      // 3. Si no, simplemente renderiza la lista
      renderRulesList(rules);
    }
  });
}


function renderRulesList(rulesArray) {
  const rulesList = document.getElementById("rulesList");
  rulesList.innerHTML = "";
  if (!rulesArray || !rulesArray.length) {
    rulesList.innerHTML = `<li class="history-list-empty-message">${chrome.i18n.getMessage("feedback_noRulesDefined")}</li>`;
    return;
  }
  rulesArray.forEach((rule) => {
    const li = document.createElement("li");
    li.dataset.id = rule.id;

    const typeStr = rule.type === 'url' ? chrome.i18n.getMessage('ruleDesc_url') : chrome.i18n.getMessage('ruleDesc_name');
    let ruleText = `${chrome.i18n.getMessage('ruleDesc_if')} <b>${typeStr}</b> ${chrome.i18n.getMessage('ruleDesc_contains')} "<b>${rule.value}</b>", ${chrome.i18n.getMessage('ruleDesc_saveIn')} "<b>${rule.folder}</b>"`;
    if (rule.renamePattern) {
      ruleText += ` ${chrome.i18n.getMessage('ruleDesc_andRenameAs')} "<b>${rule.renamePattern}</b>"`;
    }
    li.innerHTML = `<span class="history-item-text">${ruleText}</span>`;

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "history-item-actions";

    const editBtn = document.createElement("button");
    editBtn.textContent = chrome.i18n.getMessage("editButton");
    editBtn.addEventListener("click", () => enterEditMode(rule.id));
    actionsDiv.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = chrome.i18n.getMessage("deleteButton");
    deleteBtn.style.backgroundColor = "var(--error-bg-color)";
    deleteBtn.style.borderColor = "var(--error-border-color)";
    deleteBtn.style.color = "var(--error-text-color)";
    deleteBtn.addEventListener("click", () => removeRule(rule.id));
    actionsDiv.appendChild(deleteBtn);

    li.appendChild(actionsDiv);
    rulesList.appendChild(li);
  });

  new Sortable(rulesList, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: (e) => saveRulesOrder(e.target)
  });
}

function addRule() {
  const type = document.getElementById("ruleType").value;
  const value = document.getElementById("ruleValue").value.trim();
  const folder = document.getElementById("ruleFolder").value.trim();
  const renamePattern = getRenamePatternString();

  if (!value || !folder) {
    showStatus(chrome.i18n.getMessage("feedback_errorCompleteFields"), "error");
    return;
  }

  chrome.storage.sync.get({ customRules: [] }, (data) => {
    const newRule = {
      id: `rule_${Date.now()}`,
      type, value, folder, renamePattern
    };
    const newRules = [...data.customRules, newRule];
    chrome.storage.sync.set({ customRules: newRules }, () => {
      showStatus(chrome.i18n.getMessage("statusRuleAdded"), "success");
      exitEditMode();
    });
  });
}

function updateRule() {
  if (!editingRuleId) return;

  const type = document.getElementById("ruleType").value;
  const value = document.getElementById("ruleValue").value.trim();
  const folder = document.getElementById("ruleFolder").value.trim();
  const renamePattern = getRenamePatternString();

  if (!value || !folder) {
    showStatus(chrome.i18n.getMessage("feedback_errorCompleteFields"), "error");
    return;
  }

  chrome.storage.sync.get({ customRules: [] }, (data) => {
    const rules = data.customRules;
    const ruleIndex = rules.findIndex(r => r.id === editingRuleId);
    if (ruleIndex === -1) {
      showStatus(chrome.i18n.getMessage("feedback_errorUpdateNotFound"), "error");
      exitEditMode();
      return;
    }

    rules[ruleIndex] = { id: editingRuleId, type, value, folder, renamePattern };

    chrome.storage.sync.set({ customRules: rules }, () => {
      showStatus(chrome.i18n.getMessage("statusRuleUpdated"), "success");
      exitEditMode();
    });
  });
}

function removeRule(ruleId) {
  if (!ruleId) {
    showStatus(chrome.i18n.getMessage("feedback_errorDeleteNoId"), "error");
    return;
  }
  chrome.storage.sync.get({ customRules: [] }, (data) => {
    const newRules = data.customRules.filter(rule => rule.id !== ruleId);
    chrome.storage.sync.set({ customRules: newRules }, () => {
      showStatus(chrome.i18n.getMessage("statusRuleDeleted"), "success");
    });
  });
}

async function saveRulesOrder(rulesListElement) {
  const newRulesOrder = [];
  const listItems = rulesListElement.querySelectorAll("li");
  const { customRules = [] } = await chrome.storage.sync.get('customRules');

  listItems.forEach(item => {
    const ruleId = item.dataset.id;
    if (ruleId) {
      const foundRule = customRules.find(r => r.id === ruleId);
      if (foundRule) newRulesOrder.push(foundRule);
    }
  });

  if (newRulesOrder.length !== customRules.length) {
    const orderedIds = new Set(newRulesOrder.map(r => r.id));
    const unorderedRules = customRules.filter(r => !orderedIds.has(r.id));
    newRulesOrder.push(...unorderedRules);
  }

  chrome.storage.sync.set({ customRules: newRulesOrder });
}

function updateHistory() {
  chrome.storage.local.get({ downloadHistory: [] }, (result) => {
    fullHistory = result.downloadHistory;
    renderHistoryList(fullHistory);
  });
}

function filterHistory(query) {
  if (!query) {
    renderHistoryList(fullHistory);
    return;
  }
  const filtered = fullHistory.filter(entry =>
    entry.filename.toLowerCase().includes(query) ||
    entry.folder.toLowerCase().includes(query) ||
    (entry.date && new Date(entry.date).toLocaleString().toLowerCase().includes(query))
  );
  renderHistoryList(filtered);
}

function renderHistoryList(historyArray) {
  const historyList = document.getElementById("downloadHistory");
  historyList.innerHTML = "";
  if (!historyArray.length) {
    historyList.innerHTML = `<li class="history-list-empty-message">${chrome.i18n.getMessage("feedback_noHistoryResults")}</li>`;
    return;
  }
  const reversed = [...historyArray].reverse();
  reversed.forEach(entry => {
    const listItem = document.createElement("li");
    const textSpan = document.createElement("span");
    textSpan.className = "history-item-text";
    const displayDate = entry.date ? new Date(entry.date).toLocaleString() : chrome.i18n.getMessage("label_invalidDate");
    textSpan.textContent = `${displayDate}: ${entry.filename} → ${entry.folder}`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "history-item-actions";
    if (entry.id !== undefined && entry.id !== null) {
      const openFolderBtn = document.createElement("button");
      openFolderBtn.textContent = chrome.i18n.getMessage("button_openContainingFolder");
      openFolderBtn.addEventListener("click", () => openFolderInExplorer(entry.id));
      actionsDiv.appendChild(openFolderBtn);
    }
    if (entry.url) {
      const reDownloadBtn = document.createElement("button");
      reDownloadBtn.textContent = chrome.i18n.getMessage("redownloadButton");
      reDownloadBtn.addEventListener("click", () => chrome.downloads.download({ url: entry.url }));
      actionsDiv.appendChild(reDownloadBtn);
      const copyLinkBtn = document.createElement("button");
      copyLinkBtn.textContent = chrome.i18n.getMessage("button_copyLink");
      copyLinkBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(entry.url)
          .then(() => showStatus(chrome.i18n.getMessage("feedback_linkCopied"), "success"))
          .catch(err => showStatus(chrome.i18n.getMessage("feedback_errorCopyLink"), "error"));
      });
      actionsDiv.appendChild(copyLinkBtn);
    }
    listItem.appendChild(textSpan);
    listItem.appendChild(actionsDiv);
    historyList.appendChild(listItem);
  });
}

function clearHistory() {
  if (confirm(chrome.i18n.getMessage("confirmClearHistory"))) {
    chrome.storage.local.set({ downloadHistory: [] }, () => {
      showStatus(chrome.i18n.getMessage("statusHistoryCleared"), "success");
    });
  }
}

// ===================================================
// FUNCIONES PARA EL ORGANIZADOR BAJO DEMANDA
// ===================================================

function setupOnDemandOrganizer() {
  const scanBtn = document.getElementById("scanHistoryBtn");
  const researchBtn = document.getElementById("researchBtn");
  const loadingSpinner = document.getElementById("scanner-loading");
  const resultsContainer = document.getElementById("scanResultsContainer");
  const resultsList = document.getElementById("scanResultsList");
  const organizeBtn = document.getElementById("organizeSelectedBtn");
  const cancelBtn = document.getElementById("cancelScanBtn");
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");

  scanBtn.addEventListener("click", scanHistoryAndSuggest);
  researchBtn.addEventListener("click", scanHistoryAndSuggest);
  organizeBtn.addEventListener("click", organizeSelectedFiles);
  cancelBtn.addEventListener("click", exitScanMode);

  selectAllCheckbox.addEventListener("change", (event) => {
    const isChecked = event.target.checked;
    document.querySelectorAll('#scanResultsList input[type="checkbox"]').forEach(checkbox => {
      checkbox.checked = isChecked;
    });
  });

  resultsList.addEventListener('click', (event) => {
    if (event.target.type === 'checkbox') {
      updateSelectAllCheckboxState();
    }
  });

  function exitScanMode() {
    resultsContainer.style.display = "none";
    loadingSpinner.style.display = "none";
    researchBtn.style.display = "none";
    scanBtn.style.display = "inline-block";
    resultsList.innerHTML = "";
  }

  function updateSelectAllCheckboxState() {
    const allCheckboxes = document.querySelectorAll('#scanResultsList input[type="checkbox"]');
    const checkedCount = document.querySelectorAll('#scanResultsList input[type="checkbox"]:checked').length;
    const selectAllCheckbox = document.getElementById("selectAllCheckbox");

    if (allCheckboxes.length > 0) {
      selectAllCheckbox.checked = checkedCount === allCheckboxes.length;
      selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }
  }

  async function scanHistoryAndSuggest() {
    scanBtn.style.display = "none";
    researchBtn.style.display = "none";
    loadingSpinner.style.display = "block";

    const startDate = document.getElementById("filterStartDate").value;
    const endDate = document.getElementById("filterEndDate").value;
    const forceInclude = document.getElementById("forceInclude").checked;

    const query = {
      orderBy: ['-startTime']
    };

    if (startDate) {
      const localStartDate = new Date(startDate + 'T00:00:00');
      query.startedAfter = localStartDate.toISOString();
    }
    if (endDate) {
      const localEndDate = new Date(endDate + 'T23:59:59.999');
      query.startedBefore = localEndDate.toISOString();
    }

    const { customRules = [] } = await chrome.storage.sync.get('customRules');

    chrome.downloads.search(query, (downloadItems) => {

      const filteredFiles = downloadItems.filter(item => {
        const passesExistenceCheck = forceInclude || item.exists;
        return passesExistenceCheck && item.state === 'complete';
      });

      const suggestions = filteredFiles.map(item => {
        let suggestedFolder = null;
        const baseFilename = item.filename.split(/[\\/]/).pop();

        for (const rule of customRules) {
          const ruleValue = (rule.value || '').toLowerCase();
          if (!ruleValue) continue;

          if (rule.type === 'keyword' && baseFilename.toLowerCase().includes(ruleValue)) {
            suggestedFolder = rule.folder;
            break;
          }
          if (rule.type === 'url' && item.url.toLowerCase().includes(ruleValue)) {
            suggestedFolder = rule.folder;
            break;
          }
        }
        if (!suggestedFolder) {
          const ext = (baseFilename.split('.').pop() || "").toLowerCase();
          suggestedFolder = getFolderNameByI18n(ext);
        }
        return { ...item, suggestedFolder };
      });

      loadingSpinner.style.display = "none";
      const title = chrome.i18n.getMessage("title_scanResults", String(suggestions.length));
      document.getElementById("scanResultsTitle").textContent = title;
      renderScanResults(suggestions);
      resultsContainer.style.display = "block";
      researchBtn.style.display = "inline-block";
    });
  }

  function renderScanResults(files) {
    resultsList.innerHTML = "";
    if (files.length === 0) {
      resultsList.innerHTML = `<li class="history-list-empty-message">${chrome.i18n.getMessage("feedback_noScanResults")}</li>`;
      document.getElementById("organizeSelectedBtn").style.display = 'none';
    } else {
      document.getElementById("organizeSelectedBtn").style.display = 'inline-block';
      files.forEach(file => {
        const li = document.createElement("li");
        li.className = "scan-result-item";
        li.innerHTML = `
          <input type="checkbox" data-url="${file.url}" checked> 
          <span class="history-item-text">
            ${file.filename} → <strong>📂 ${file.suggestedFolder}</strong>
          </span>
        `;
        resultsList.appendChild(li);
      });
    }
    updateSelectAllCheckboxState();
  }

  function organizeSelectedFiles() {
    const selectedCheckboxes = document.querySelectorAll('#scanResultsList input[type="checkbox"]:checked');
    if (selectedCheckboxes.length === 0) {
      showStatus(chrome.i18n.getMessage("feedback_selectAtLeastOneFile"), "info");
      return;
    }

    let organizedCount = 0;
    selectedCheckboxes.forEach(checkbox => {
      const url = checkbox.dataset.url;
      if (url) {
        chrome.downloads.download({ url: url, conflictAction: 'uniquify' });
        organizedCount++;
      }
    });

    const message = chrome.i18n.getMessage("feedback_organizationStarted", String(organizedCount));
    showStatus(message, "success");
    exitScanMode();
  }
}

/**
 * Obtiene el nombre de la carpeta traducida basándose en la extensión del archivo.
 * @param {string} ext - La extensión del archivo en minúsculas.
 * @returns {string} El nombre de la carpeta traducido.
 */
function getFolderNameByI18n(ext) {
  // Mapea extensiones a las claves del archivo messages.json
  const keyMap = {
    'pdf': 'folder_pdfs',
    'jpg': 'folder_images', 'jpeg': 'folder_images', 'png': 'folder_images', 'gif': 'folder_images', 'webp': 'folder_images',
    'mp4': 'folder_videos', 'mkv': 'folder_videos', 'avi': 'folder_videos', 'webm': 'folder_videos',
    'mp3': 'folder_audio', 'wav': 'folder_audio', 'ogg': 'folder_audio',
    'zip': 'folder_compressed', 'rar': 'folder_compressed', '7z': 'folder_compressed',
    'docx': 'folder_documents', 'doc': 'folder_documents', 'odt': 'folder_documents',
    'txt': 'folder_text', 'md': 'folder_text',
    'csv': 'folder_spreadsheets', 'xlsx': 'folder_spreadsheets', 'xls': 'folder_spreadsheets',
    'exe': 'folder_programs', 'msi': 'folder_programs',
    'js': 'folder_code', 'html': 'folder_code', 'css': 'folder_code', 'py': 'folder_code', 'json': 'folder_code'
  };
  const defaultKey = 'folder_other';
  const i18nKey = keyMap[ext] || defaultKey;

  // Devuelve el texto traducido usando la API de Chrome
  return chrome.i18n.getMessage(i18nKey);
}

function exportRules() {
  chrome.storage.sync.get({ customRules: [] }, (data) => {
    if (data.customRules.length === 0) {
      showStatus(chrome.i18n.getMessage("feedback_noRulesToExport"), "info");
      return;
    }
    const jsonString = JSON.stringify(data.customRules, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "descargas-en-orden-reglas.json";
    a.click();
    URL.revokeObjectURL(url);
    showStatus(chrome.i18n.getMessage("feedback_rulesExported"), "success");
  });
}

function importRules(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const newRules = JSON.parse(e.target.result);
      if (!Array.isArray(newRules)) {
        throw new Error(chrome.i18n.getMessage("error_importWrongFormat"));
      }
      if (confirm(chrome.i18n.getMessage("confirm_importOverwrite"))) {
        const rulesWithId = newRules.map(rule => ({ ...rule, id: rule.id || `rule_${Date.now()}_${Math.random()}` }));
        chrome.storage.sync.set({ customRules: rulesWithId }, () => {
          showStatus(chrome.i18n.getMessage("feedback_rulesImported"), "success");
        });
      }
    } catch (error) {
      showStatus(chrome.i18n.getMessage("feedback_errorImport", error.message), "error");
    } finally {
      event.target.value = null;
    }
  };
  reader.readAsText(file);
}

function showStatus(message, type = 'info') {
  const statusElement = document.getElementById("status");
  statusElement.textContent = message;
  statusElement.className = 'status';
  statusElement.classList.add(type);
  statusElement.classList.add('visible');

  setTimeout(() => {
    statusElement.classList.remove('visible');
  }, 3000);
}

function openFolderInExplorer(downloadId) {
  const numId = Number(downloadId);
  if (isNaN(numId)) {
    showStatus(chrome.i18n.getMessage("feedback_errorInvalidDownloadId"), "error");
    return;
  }

  chrome.downloads.search({ id: numId }, (results) => {
    if (chrome.runtime.lastError) {
      showStatus(chrome.i18n.getMessage("feedback_errorSearchingDownload", chrome.runtime.lastError.message), "error");
      return;
    }

    if (!results || !results.length) {
      showStatus(chrome.i18n.getMessage("feedback_errorNotInHistory"), "info");
      return;
    }

    if (!results[0].exists) {
      showStatus(chrome.i18n.getMessage("feedback_errorFileNotExists"), "error");
      return;
    }

    chrome.downloads.show(numId);
  });
}

function saveDefaultCategories() {
  const defaultCategories = {
    pdf: document.getElementById("cat_pdf").checked,
    images: document.getElementById("cat_images").checked,
    video: document.getElementById("cat_video").checked,
    audio: document.getElementById("cat_audio").checked,
    compressed: document.getElementById("cat_compressed").checked,
    documents: document.getElementById("cat_documents").checked,
    programs: document.getElementById("cat_programs").checked
  };
  chrome.storage.sync.set({ defaultCategories }, () => {
    // Feedback silencioso (opcional)
    console.log("Categorías guardadas");
  });
}