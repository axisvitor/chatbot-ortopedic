const { validateEnvVar } = require('../../../config/settings');

const NUVEMSHOP_CONFIG = {
    // Configurações da API
    apiUrl: validateEnvVar('NUVEMSHOP_API_URL'),
    accessToken: validateEnvVar('NUVEMSHOP_ACCESS_TOKEN'),
    userId: validateEnvVar('NUVEMSHOP_USER_ID'),
    scope: validateEnvVar('NUVEMSHOP_SCOPE').split(','),

    // Configurações do webhook
    webhook: {
        secret: validateEnvVar('NUVEMSHOP_WEBHOOK_SECRET'),
        topics: [
            'orders/created',
            'orders/paid',
            'orders/fulfilled',
            'orders/cancelled',
            'products/created',
            'products/updated',
            'products/deleted',
            'customers/created',
            'customers/updated'
        ]
    },

    // Configurações de cache
    cache: {
        prefix: 'nuvemshop:',
        ttl: {
            orders: 300, // 5 minutos
            products: 600, // 10 minutos
            customers: 900, // 15 minutos
            categories: 1800, // 30 minutos
            brands: 1800 // 30 minutos
        }
    },

    // Configurações da API
    api: {
        timeout: 30000, // 30 segundos
        retryAttempts: 3,
        retryDelay: 1000, // 1 segundo
        maxRequestsPerSecond: 10
    },

    // Configurações de logs
    logs: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        prefix: '[NuvemShop]'
    },

    // Configurações de formatação
    format: {
        dateFormat: 'DD/MM/YYYY HH:mm:ss',
        priceFormat: {
            locale: 'pt-BR',
            currency: 'BRL'
        }
    },

    // Configurações de internacionalização
    i18n: {
        defaultLanguage: 'pt',
        supportedLanguages: ['pt', 'es', 'en']
    },

    // Configurações de validação
    validation: {
        maxProductsPerPage: 200,
        maxOrdersPerPage: 200,
        maxCustomersPerPage: 200,
        minSearchLength: 3
    },

    // Configurações de segurança
    security: {
        allowedIps: validateEnvVar('NUVEMSHOP_ALLOWED_IPS').split(','),
        rateLimitWindow: 60000, // 1 minuto
        maxRequestsPerWindow: 100
    }
};

module.exports = { NUVEMSHOP_CONFIG };
