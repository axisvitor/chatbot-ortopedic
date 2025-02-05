require('dotenv').config();

// Função para validar variáveis de ambiente
function validateEnvVar(name, defaultValue = undefined) {
    const value = process.env[name];
    if (value) return value;
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Environment variable ${name} is required`);
}

// Configurações do Redis
const REDIS_CONFIG = {
    host: validateEnvVar('REDIS_HOST', 'localhost'),
    port: parseInt(validateEnvVar('REDIS_PORT', '6379')),
    password: validateEnvVar('REDIS_PASSWORD', ''),
    prefix: {
        tracking: 'loja:tracking:'
    }
};

// Configurações da Nuvemshop
const NUVEMSHOP_CONFIG = {
    // Configurações básicas da API
    apiUrl: validateEnvVar('NUVEMSHOP_API_URL'),
    accessToken: validateEnvVar('NUVEMSHOP_ACCESS_TOKEN'),
    userId: validateEnvVar('NUVEMSHOP_USER_ID'),
    
    // Configurações do webhook
    webhook: {
        topics: [
            'orders/created',
            'orders/paid',
            'orders/fulfilled',
            'orders/cancelled',
            'orders/updated'
        ],
        timeout: 5000 // 5 segundos
    },

    // Configurações de API necessárias
    api: {
        timeout: 30000, // 30 segundos
        retryAttempts: 3,
        retryDelays: [1000, 3000, 5000], // 1s, 3s, 5s
        userAgent: 'API Loja Ortopedic (suporte@lojaortopedic.com.br)'
    },

    // Configurações de cache necessárias
    cache: {
        ttl: {
            orders: 3600  // 1 hora
        },
        prefix: {
            orders: 'nuvemshop:orders:'
        }
    },

    // Configurações de validação necessárias
    validation: {
        maxOrdersPerPage: 40
    },

    // Flag de habilitado
    enabled: Boolean(
        process.env.NUVEMSHOP_API_URL && 
        process.env.NUVEMSHOP_ACCESS_TOKEN && 
        process.env.NUVEMSHOP_USER_ID
    )
};

// Configurações do Tracking
const TRACKING_CONFIG = {
    endpoint: validateEnvVar('TRACK17_API_URL'),
    apiKey: validateEnvVar('TRACK17_API_KEY'),
    paths: {
        register: validateEnvVar('TRACK17_REGISTER_PATH', '/track/v2.2/register'),
        status: validateEnvVar('TRACK17_STATUS_PATH', '/track/v2.2/gettrackinfo'),
        track: validateEnvVar('TRACK17_TRACK_PATH', '/track/v2.2/trackinfo'),
        push: validateEnvVar('TRACK17_PUSH_PATH', '/track/v2.2/push')
    },
    webhookSecret: validateEnvVar('TRACK17_WEBHOOK_SECRET'),
    updateInterval: 30 * 60 * 1000, // 30 minutos
    limits: {
        maxTrackingNumbers: 40,
        rateLimit: {
            maxRequests: 1000,
            interval: 3600000 // 1 hora
        }
    },
    carriers: ['correios', 'jadlog', 'sequoia'],
    cache: {
        ttl: {
            default: 30 * 60, // 30 minutos
            status: {
                final: 24 * 60 * 60,    // 24 horas para status finais
                problem: 2 * 60 * 60,   // 2 horas para status com problema
                transit: 30 * 60,       // 30 minutos para em trânsito
                posted: 15 * 60,        // 15 minutos para recém postado
                default: 5 * 60         // 5 minutos para outros status
            }
        }
    }
};

module.exports = {
    REDIS_CONFIG,
    TRACKING_CONFIG,
    NUVEMSHOP_CONFIG
};
