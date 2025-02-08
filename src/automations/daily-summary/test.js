const { CustomsSummary } = require('./customs-summary');

// Configurações específicas para teste
const config = {
    endpoint: 'https://api.17track.net',
    apiKey: 'B98966348453793271B4F98DF05638E0',
    whatsappNumber: process.env.WHATSAPP_NUMBER || '5511999999999' // número padrão para teste
};

console.log('Configurações de teste:', {
    ...config,
    apiKey: '***' // Oculta a chave por segurança
});

const axios = require('axios');

// Adiciona interceptor para logar todas as requisições
axios.interceptors.request.use(request => {
    console.log('Requisição:', {
        url: request.url,
        method: request.method,
        headers: {
            ...request.headers,
            '17token': '***' // Oculta o token por segurança
        },
        data: request.data
    });
    return request;
});

// Adiciona interceptor para logar todas as respostas
axios.interceptors.response.use(
    response => {
        console.log('Resposta:', {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data
        });
        return response;
    },
    error => {
        console.error('Erro na resposta:', {
            message: error.message,
            response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            } : 'No response',
            config: error.config ? {
                url: error.config.url,
                method: error.config.method,
                headers: {
                    ...error.config.headers,
                    '17token': '***' // Oculta o token por segurança
                },
                data: error.config.data
            } : 'No config'
        });
        return Promise.reject(error);
    }
);

try {
    const customsSummary = new CustomsSummary(config);
    console.log('CustomsSummary instanciado com sucesso');

    // Teste a geração do resumo diário
    customsSummary.generateDailySummary()
        .then(result => console.log('Resultado:', result))
        .catch(error => {
            console.error('Erro na geração:', error);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Data:', error.response.data);
            }
            process.exit(1);
        });
} catch (error) {
    console.error('Erro na instanciação:', error);
    process.exit(1);
}
