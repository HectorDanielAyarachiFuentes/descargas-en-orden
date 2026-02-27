// welcome.js
document.addEventListener('DOMContentLoaded', () => {
    // Aplicar i18n si existe la función o manual
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const message = chrome.i18n.getMessage(element.dataset.i18n);
        if (message) {
            if (message.includes('<') && message.includes('>')) {
                element.innerHTML = message;
            } else {
                element.textContent = message;
            }
        }
    });

    // Detectar tema (reutilizando variable del sistema de Opciones si es posible)
    chrome.storage.sync.get({ theme: 'auto' }, (data) => {
        let shouldUseDark = false;
        if (data.theme === 'auto') {
            shouldUseDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        } else {
            shouldUseDark = data.theme === 'dark';
        }
        if (shouldUseDark) document.documentElement.classList.add('dark-mode');
    });

    document.getElementById('open-options-btn').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
});
