function generateClientId() {
    return `MQTTLooter-${Math.random().toString(36).substr(2, 9)}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTimestamp(timestamp) {
    try {
        return new Date(timestamp).toLocaleString();
    } catch (error) {
        return timestamp;
    }
}

function showToast(message, type = 'info') {
    const backgroundColor = {
        'success': '#2ecc71',
        'error': '#e74c3c',
        'warning': '#f39c12',
        'info': '#3498db'
    };

    // Check if Toastify is available
    if (typeof Toastify !== 'undefined') {
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "right",
            style: {
                background: backgroundColor[type] || backgroundColor.info,
            }
        }).showToast();
    } else {
        // Fallback to simple visual feedback
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${backgroundColor[type] || backgroundColor.info};
            color: white;
            padding: 12px 20px;
            border-radius: 5px;
            z-index: 10000;
            font-size: 14px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (document.body.contains(toast)) {
                document.body.removeChild(toast);
            }
        }, 3000);
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

module.exports = {
    generateClientId,
    escapeHtml,
    formatTimestamp,
    showToast,
    debounce,
    throttle
};