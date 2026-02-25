// theme-manager.js
// Gestor centralizado de temas para la extensión

/**
 * Inicializa el sistema de temas
 * Detecta preferencias del sistema y del usuario
 */
async function initTheme() {
  // Obtener preferencia guardada del usuario
  const { theme = 'auto' } = await chrome.storage.sync.get('theme');
  applyTheme(theme);
}

/**
 * Aplica el tema según la preferencia
 * @param {string} preference - 'light', 'dark', o 'auto'
 */
function applyTheme(preference) {
  let shouldUseDark = false;

  if (preference === 'auto') {
    // Detectar preferencia del sistema
    shouldUseDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    shouldUseDark = preference === 'dark';
  }

  // Aplicar o remover la clase dark-mode
  if (shouldUseDark) {
    document.documentElement.classList.add('dark-mode');
  } else {
    document.documentElement.classList.remove('dark-mode');
  }

  // Guardar el estado actual para acceso rápido
  document.documentElement.setAttribute('data-theme', shouldUseDark ? 'dark' : 'light');
}

/**
 * Cambiar la preferencia de tema del usuario
 * @param {string} newTheme - 'light', 'dark', o 'auto'
 */
async function setThemePreference(newTheme) {
  await chrome.storage.sync.set({ theme: newTheme });
  applyTheme(newTheme);
}

/**
 * Obtener la preferencia actual de tema
 * @returns {Promise<string>} - 'light', 'dark', o 'auto'
 */
async function getThemePreference() {
  const { theme = 'auto' } = await chrome.storage.sync.get('theme');
  return theme;
}

// Escuchar cambios en la preferencia del sistema (solo para modo auto)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
  const { theme = 'auto' } = await chrome.storage.sync.get('theme');
  if (theme === 'auto') {
    applyTheme('auto');
  }
});

// Escuchar cambios en storage (sincronización entre páginas)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.theme) {
    applyTheme(changes.theme.newValue);
  }
});

// Exportar funciones
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initTheme, applyTheme, setThemePreference, getThemePreference };
}