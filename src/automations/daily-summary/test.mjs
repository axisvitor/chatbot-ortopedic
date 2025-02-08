import { CustomsSummary } from './customs-summary.js';

const config = {
    endpoint: 'https://api.17track.net',
    apiKey: 'test-key',
    whatsappNumber: '5511999999999'
};

const customsSummary = new CustomsSummary(config);

// Teste a geração do resumo diário
customsSummary.generateDailySummary()
    .then(result => console.log('Resultado:', result))
    .catch(error => console.error('Erro:', error));
