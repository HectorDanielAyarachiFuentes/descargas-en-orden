// background.js

let lastClickedTabUrl = '';

// ========================================================
// Listeners para URL de pestaña activa
// ========================================================
chrome.tabs.onActivated.addListener(activeInfo => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (!chrome.runtime.lastError && tab && tab.url) {
            lastClickedTabUrl = tab.url;
        }
    });
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        lastClickedTabUrl = changeInfo.url;
    }
});

// =====================
// Funciones de Utilidad
// =====================

/**
 * Obtiene la URL de origen de la descarga de forma segura.
 */
async function getOriginUrl(downloadItem) {
    if (downloadItem.tabId && downloadItem.tabId !== -1) {
        try {
            const tab = await chrome.tabs.get(downloadItem.tabId);
            return tab.url || lastClickedTabUrl || '';
        } catch (e) {
            return lastClickedTabUrl || '';
        }
    }
    return lastClickedTabUrl || '';
}

/**
 * Obtiene el nombre de la carpeta según la extensión,
 * respetando si el usuario ha desactivado esa categoría.
 */
function getFolderNameByExtension(ext, enabledCats = {}) {
    // Valores por defecto: todo activado si no se pasa configuración
    const cats = {
        pdf: true, images: true, video: true, audio: true,
        compressed: true, documents: true, spreadsheets: true, presentations: true, programs: true,
        ...enabledCats
    };

    const lowerExt = ext.toLowerCase();

    switch (lowerExt) {
        case 'pdf':
            return cats.pdf ? chrome.i18n.getMessage("folder_pdfs") : null;

        case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp':
            return cats.images ? chrome.i18n.getMessage("folder_images") : null;

        case 'mp4': case 'mkv': case 'avi': case 'webm':
            return cats.video ? chrome.i18n.getMessage("folder_videos") : null;

        case 'mp3': case 'wav': case 'ogg':
            return cats.audio ? chrome.i18n.getMessage("folder_audio") : null;

        case 'zip': case 'rar': case '7z':
            return cats.compressed ? chrome.i18n.getMessage("folder_compressed") : null;

        // Agrupamos documentos de texto y office bajo la categoría 'documents'
        case 'docx': case 'doc': case 'odt':
            return cats.documents ? chrome.i18n.getMessage("folder_documents") : null;
        case 'txt': case 'md':
            return cats.documents ? chrome.i18n.getMessage("folder_text") : null;

        case 'csv': case 'xlsx': case 'xls':
            return cats.spreadsheets ? chrome.i18n.getMessage("folder_spreadsheets") : null;

        case 'ppt': case 'pptx': case 'odp':
            return cats.presentations ? chrome.i18n.getMessage("folder_presentations") : null;

        case 'exe': case 'msi':
            return cats.programs ? chrome.i18n.getMessage("folder_programs") : null;

        case 'js': case 'html': case 'css': case 'py': case 'json':
            // Asumiendo que consideras estos como documentos u otra categoría,
            // pero si no hay toggle, puedes devolver null para no organizarlos si están fuera de las cajas.
            // O mantenerlos como 'programs' o crear una categoría 'code'. Por ahora los dejaremos devolver null si quieres desactivarlos.
            // Para mantener consistencia con "si no está activado, no hacer nada", requerimos un toggle o retornamos null.
            return null; // Si quieres que los archivos código se organicen por defecto en una carpeta, diles si 'programs' está activo, etc. Ej: cats.programs ? chrome.i18n.getMessage("folder_code") : null;

        default:
            return null;
    }
}

function sanitize(name) {
    return name.replace(/[<>:"/\\|?*]+/g, '_');
}

function applyRenamePattern(pattern, downloadItem, originUrl) {
    const now = new Date();
    const dateParts = {
        YYYY: now.getFullYear(),
        YY: String(now.getFullYear()).slice(-2),
        MM: String(now.getMonth() + 1).padStart(2, '0'),
        DD: String(now.getDate()).padStart(2, '0'),
        hh: String(now.getHours()).padStart(2, '0'),
        mm: String(now.getMinutes()).padStart(2, '0'),
        ss: String(now.getSeconds()).padStart(2, '0'),
    };
    const filenameParts = downloadItem.filename.split('.');
    const extension = (filenameParts.pop() || "").toLowerCase();
    const originalFilename = filenameParts.join('.');
    let site = chrome.i18n.getMessage("unknownSite");
    if (originUrl) {
        try {
            site = new URL(originUrl).hostname.replace(/^www\./, '').split('.')[0];
        } catch (e) { console.log("URL de origen no válida para extraer sitio:", e); }
    }
    let newName = pattern;
    newName = newName.replace(/\[sitio\]/g, site);
    newName = newName.replace(/\[nombre_original\]/g, originalFilename);
    newName = newName.replace(/\[fecha:([^\]]+)\]/g, (match, format) => {
        return format.replace(/YYYY|YY|MM|DD|hh|mm|ss/g, part => dateParts[part]);
    });
    return `${newName}.${extension}`;
}

function saveToDownloadHistory(filename, folderName, downloadId, fileUrl) {
    chrome.storage.local.get({ downloadHistory: [] }, (result) => {
        const history = result.downloadHistory;
        if (history.length >= 50) { history.shift(); }
        const newEntry = { filename, folder: folderName, date: new Date().toISOString(), id: downloadId, url: fileUrl };
        history.push(newEntry);
        chrome.storage.local.set({ downloadHistory: history });
    });
}

function showNotification(sanitizedFilename, folderName) {
    chrome.storage.sync.get({ notifications: 'always' }, (data) => {
        if (data.notifications !== 'always') return;

        chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("icon128.png"),
            title: chrome.i18n.getMessage("notificationSuccessTitle"),
            message: chrome.i18n.getMessage("notificationSuccessMessage", [sanitizedFilename, folderName]),
            priority: 1
        });
    });
}

function showErrorNotification(title, message) {
    chrome.storage.sync.get({ notifications: 'always' }, (data) => {
        if (data.notifications === 'never') return;

        chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("icon128.png"),
            title: title,
            message: message,
            priority: 2
        });
    });
}

// =====================
// Lógica del Menú Contextual
// =====================
async function updateContextMenu() {
    await chrome.contextMenus.removeAll();

    const { contextMenu, customRules = [] } = await chrome.storage.sync.get({ contextMenu: true, customRules: [] });

    if (!contextMenu) return;

    const uniqueFolders = new Set(customRules.map(rule => rule.folder));
    if (uniqueFolders.size === 0) return;

    const contexts = ["link", "image", "video", "audio"];
    chrome.contextMenus.create({
        id: "save-in-parent",
        title: chrome.i18n.getMessage("contextMenu_saveIn"),
        contexts
    });

    uniqueFolders.forEach(folder => {
        if (folder) {
            chrome.contextMenus.create({ id: folder, parentId: "save-in-parent", title: `📁 ${folder}`, contexts });
        }
    });
}

// =====================
// Eventos de la Extensión
// =====================
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log("Extensión de Descargas en Orden instalada/actualizada.");
    updateContextMenu();

    // Solo ejecuta esta lógica cuando la extensión se instala por primera vez.
    if (details.reason === 'install') {
        // Abrir la página de bienvenida (Onboarding)
        chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });

        try {
            // Comprueba si la API de Brave está disponible y si el navegador es Brave.
            if (navigator.brave && await navigator.brave.isBrave()) {

                // Si es Brave, muestra una notificación especial con las instrucciones.
                chrome.notifications.create('brave-setup-notification', {
                    type: 'basic',
                    iconUrl: chrome.runtime.getURL("icon128.png"),
                    title: chrome.i18n.getMessage("notification_braveSetupTitle"),
                    message: chrome.i18n.getMessage("notification_braveSetupMessage"),
                    priority: 2,
                    // Mantiene la notificación visible hasta que el usuario la descarte.
                    requireInteraction: true
                });
            }
        } catch (error) {
            console.error("Error al comprobar si el navegador es Brave:", error);
        }
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.customRules || changes.contextMenu)) {
        updateContextMenu();
    }
});

chrome.contextMenus.onClicked.addListener((info) => {
    const destinationFolder = info.menuItemId;
    const downloadUrl = info.srcUrl || info.linkUrl;
    if (!downloadUrl || !destinationFolder || destinationFolder === "save-in-parent") return;

    chrome.downloads.download({ url: downloadUrl, conflictAction: 'uniquify' }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error("Error al iniciar descarga desde menú contextual:", chrome.runtime.lastError.message);
            showErrorNotification(
                chrome.i18n.getMessage("notificationErrorTitle"),
                chrome.i18n.getMessage("error_contextMenuDownload", chrome.runtime.lastError.message)
            );
        } else {
            // Guardar en la sesión para que sobreviva si el Service Worker se duerme
            chrome.storage.session.get({ determinedDestinations: {} }, (result) => {
                const dests = result.determinedDestinations;
                dests[downloadId] = { folder: destinationFolder, isManual: true };
                chrome.storage.session.set({ determinedDestinations: dests });
            });
        }
    });
});

chrome.downloads.onCreated.addListener(async (downloadItem) => {
    const { determinedDestinations = {} } = await chrome.storage.session.get("determinedDestinations");
    if (downloadItem.id in determinedDestinations) return;

    const { autoOrganize, customRules = [] } = await chrome.storage.sync.get(["autoOrganize", "customRules"]);

    if (!autoOrganize) return;

    const originUrl = await getOriginUrl(downloadItem);

    for (const rule of customRules) {
        if (rule.type === 'url') {
            const ruleValue = (rule.value ?? '').toLowerCase();
            if (!ruleValue) continue;

            const downloadUrl = downloadItem.url.toLowerCase();
            const referrerUrl = (downloadItem.referrer || "").toLowerCase();
            const originUrlLower = originUrl.toLowerCase();

            if (downloadUrl.includes(ruleValue) || referrerUrl.includes(ruleValue) || originUrlLower.includes(ruleValue)) {
                // Modificado para usar storage.session
                const sessionData = await chrome.storage.session.get({ determinedDestinations: {} });
                const dests = sessionData.determinedDestinations;
                dests[downloadItem.id] = { folder: rule.folder, isManual: false, rule: rule };
                await chrome.storage.session.set({ determinedDestinations: dests });
                return;
            }
        }
    }
});


// ======================================================================
// onDeterminingFilename: LÓGICA PRINCIPAL DE ORGANIZACIÓN
// ======================================================================
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    (async () => {
        const { forceNextDownload } = await chrome.storage.local.get("forceNextDownload");
        if (forceNextDownload && forceNextDownload.folder) {
            let finalFilename = sanitize(downloadItem.filename);
            let finalPath = `${sanitize(forceNextDownload.folder)}/${finalFilename}`;
            suggest({ filename: finalPath, conflictAction: 'uniquify' });
            await chrome.storage.local.remove("forceNextDownload");
            chrome.action.setBadgeText({ text: '' });
            saveToDownloadHistory(finalFilename, forceNextDownload.folder, downloadItem.id, downloadItem.finalUrl || downloadItem.url);
            showNotification(finalFilename, forceNextDownload.folder);
            return;
        }

        // RECUPERAR PREFERENCIAS: AutoOrganize, Reglas, Categorías personalizadas y por defecto
        const { autoOrganize, customRules = [], customCategories = [], defaultCategories = {} } = await chrome.storage.sync.get({
            autoOrganize: true,
            customRules: [],
            customCategories: [],
            defaultCategories: { // Defaults en caso de que sea la primera ejecución
                pdf: true, images: true, video: true, audio: true,
                compressed: true, documents: true, spreadsheets: true, presentations: true, programs: true
            }
        });

        if (!autoOrganize) {
            suggest();
            return;
        }

        // Obtener el estado actual guardado en sesión
        const { determinedDestinations = {} } = await chrome.storage.session.get("determinedDestinations");
        let destinationInfo = determinedDestinations[downloadItem.id]; // Para descargas manuales o pre-calculadas
        let folderName = null;
        let finalFilename = sanitize(downloadItem.filename);
        let originUrl = '';

        // --- INICIO DE LA LÓGICA CENTRALIZADA ---
        // Solo aplicar reglas si no es una descarga manual (desde el menú contextual)
        if (!destinationInfo) {
            // 1. Obtener URL de origen de forma centralizada
            originUrl = await getOriginUrl(downloadItem);

            // 2. Iterar sobre las reglas para encontrar la primera que coincida
            for (const rule of customRules) {
                const ruleValue = (rule.value ?? '').toLowerCase();
                if (!ruleValue) continue;

                let match = false;

                // Comprobar si la regla actual coincide
                if (rule.type === 'keyword' && finalFilename.toLowerCase().includes(ruleValue)) {
                    match = true;
                } else if (rule.type === 'url') {
                    const downloadUrl = downloadItem.url.toLowerCase();
                    const referrerUrl = (downloadItem.referrer || "").toLowerCase();
                    const originUrlLower = originUrl.toLowerCase();
                    if (downloadUrl.includes(ruleValue) || referrerUrl.includes(ruleValue) || originUrlLower.includes(ruleValue)) {
                        match = true;
                    }
                }

                // Si hay coincidencia, establecer el destino y salir del bucle
                if (match) {
                    destinationInfo = { folder: rule.folder, isManual: false, rule: rule };
                    break;
                }
            }

            // 3. Iterar sobre categorías personalizadas por extensión si no hubo match en reglas
            if (!destinationInfo && customCategories.length > 0) {
                const ext = (downloadItem.filename.split('.').pop() || "").toLowerCase();
                for (const cat of customCategories) {
                    if (cat.extensions.includes(ext)) {
                        destinationInfo = { folder: cat.folder, isManual: false, rule: null };
                        break;
                    }
                }
            }
        }
        // --- FIN DE LA LÓGICA CENTRALIZADA ---

        if (destinationInfo) {
            folderName = destinationInfo.folder;
            if (destinationInfo.rule && destinationInfo.rule.renamePattern) {
                // La lógica de renombrado necesita la URL de origen
                if (!originUrl) {
                    originUrl = await getOriginUrl(downloadItem);
                }
                const newName = applyRenamePattern(destinationInfo.rule.renamePattern, downloadItem, originUrl);
                finalFilename = sanitize(newName);
            }
        } else {
            // Fallback: si ninguna regla coincide, usar la lógica de extensión
            const ext = (downloadItem.filename.split('.').pop() || "").toLowerCase();
            // AHORA PASAMOS LAS CATEGORÍAS ACTIVAS
            folderName = getFolderNameByExtension(ext, defaultCategories);

            // Si la categoría está desactivada (retorna null), no organizamos
            if (!folderName) {
                suggest();
                return;
            }
        }

        let finalPath = `${sanitize(folderName)}/${finalFilename}`;
        suggest({ filename: finalPath, conflictAction: 'uniquify' });

        if (destinationInfo) {
            // Limpiar la referencia de la sesión
            delete determinedDestinations[downloadItem.id];
            await chrome.storage.session.set({ determinedDestinations });
        }

        saveToDownloadHistory(finalFilename, folderName, downloadItem.id, downloadItem.finalUrl || downloadItem.url);

        if (!destinationInfo || !destinationInfo.isManual) {
            showNotification(finalFilename, folderName);
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#4688F1' });
            setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
        }

        // El resto de la función (rastreador de sugerencias)
        if (!destinationInfo || (!destinationInfo.isManual && !destinationInfo.rule)) {
            try {
                if (!originUrl) { // Obtener originUrl si no se ha hecho ya
                    originUrl = await getOriginUrl(downloadItem);
                }

                if (originUrl) {
                    const domain = new URL(originUrl).hostname.replace(/^www\./, '');
                    const ext = (downloadItem.filename.split('.').pop() || "").toLowerCase();
                    const key = `${domain}|${ext}|${folderName}`;

                    // LÓGICA MEJORADA: Verificar lista de ignorados
                    const { suggestionTracker = {}, ignoredSuggestions = [] } = await chrome.storage.local.get(['suggestionTracker', 'ignoredSuggestions']);

                    // Si el usuario ya rechazó esta sugerencia, no hacer nada
                    if (ignoredSuggestions.includes(key)) return;

                    suggestionTracker[key] = (suggestionTracker[key] || 0) + 1;
                    if (suggestionTracker[key] === 3) {
                        chrome.notifications.create(`suggest-rule|${key}`, {
                            type: 'basic',
                            iconUrl: chrome.runtime.getURL("icon128.png"),
                            title: chrome.i18n.getMessage("notificationSuggestionTitle"),
                            message: chrome.i18n.getMessage("notificationSuggestionMessage", [ext, domain, folderName]),
                            buttons: [
                                { title: chrome.i18n.getMessage("notificationButtonYes") },
                                { title: chrome.i18n.getMessage("notificationButtonNo") }
                            ],
                            priority: 2,
                            requireInteraction: true
                        });
                    }
                    await chrome.storage.local.set({ suggestionTracker });
                }
            } catch (e) { console.error("Error en el rastreador de sugerencias:", e); }
        }
    })();
    return true; // Es crucial para operaciones asíncronas en listeners
});


chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith('suggest-rule|')) return;

    const parts = notificationId.split('|');
    const [_, domain, ext, folder] = parts;
    const key = `${domain}|${ext}|${folder}`;

    if (buttonIndex === 0) {
        // --- OPCIÓN SÍ: CREAR REGLA ---
        const newRule = {
            id: `rule_${Date.now()}`,
            type: 'url',
            value: domain,
            folder: folder,
            renamePattern: ""
        };
        const { customRules = [] } = await chrome.storage.sync.get('customRules');
        customRules.push(newRule);
        await chrome.storage.sync.set({ customRules });

        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL("icon128.png"),
            title: chrome.i18n.getMessage("notification_ruleCreatedTitle"),
            message: chrome.i18n.getMessage("notification_ruleCreatedMessage", domain),
            priority: 1
        });
    } else {
        // --- OPCIÓN NO: RECORDAR DECISIÓN ---
        const { ignoredSuggestions = [] } = await chrome.storage.local.get('ignoredSuggestions');
        // Si no está ya en la lista, lo agregamos
        if (!ignoredSuggestions.includes(key)) {
            ignoredSuggestions.push(key);
            // Limitamos la lista para no llenar la memoria infinitamente (ej: últimos 200 ignorados)
            if (ignoredSuggestions.length > 200) ignoredSuggestions.shift();
            await chrome.storage.local.set({ ignoredSuggestions });
        }
    }

    // Limpiar el contador en ambos casos (ya sea que aceptó o rechazó)
    const { suggestionTracker } = await chrome.storage.local.get('suggestionTracker');
    if (suggestionTracker && suggestionTracker[key]) {
        delete suggestionTracker[key];
        await chrome.storage.local.set({ suggestionTracker });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "showFeedback") {
        chrome.tabs.query({ url: chrome.runtime.getURL("options.html") }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, message);
            }
        });
    }
});

chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === 'interrupted' && delta.error) {
        chrome.downloads.search({ id: delta.id }, (results) => {
            if (results && results.length > 0) {
                const filename = results[0].filename.split(/[\\/]/).pop();
                showErrorNotification(
                    chrome.i18n.getMessage("notificationErrorTitle"),
                    chrome.i18n.getMessage("error_downloadInterrupted", filename)
                );
            }
        });
    }
});