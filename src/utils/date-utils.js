/**
 * Formata tempo decorrido
 * @param {number} timestamp - Timestamp em segundos
 * @returns {string} Tempo formatado
 */
function formatTimeAgo(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const seconds = now - timestamp;
    
    const intervals = {
        ano: 31536000,
        mes: 2592000,
        semana: 604800,
        dia: 86400,
        hora: 3600,
        minuto: 60
    };

    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        
        if (interval >= 1) {
            return `há ${interval} ${unit}${interval > 1 ? 's' : ''}`;
        }
    }
    
    return 'agora mesmo';
}

module.exports = {
    formatTimeAgo
};
