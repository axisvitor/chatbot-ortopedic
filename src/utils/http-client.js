const axios = require('axios');

// Configuração global do axios
const httpClient = axios.create({
    timeout: 30000, // 30 segundos
    headers: {
        'Content-Type': 'application/json'
    }
});

module.exports = httpClient;
