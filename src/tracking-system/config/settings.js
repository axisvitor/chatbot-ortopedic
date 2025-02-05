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

// Configurações do WhatsApp
const WHATSAPP_CONFIG = {
    apiUrl: validateEnvVar('WHATSAPP_API_URL'),
    apiKey: validateEnvVar('WHATSAPP_API_KEY'),
    templates: {
        tracking: validateEnvVar('WHATSAPP_TRACKING_TEMPLATE', 'tracking_update')
    }
};

// Configurações da Nuvemshop
const NUVEMSHOP_CONFIG = {
    apiUrl: validateEnvVar('NUVEMSHOP_API_URL'),
    accessToken: validateEnvVar('NUVEMSHOP_ACCESS_TOKEN'),
    userId: validateEnvVar('NUVEMSHOP_USER_ID'),
    webhook: {
        secret: validateEnvVar('NUVEMSHOP_WEBHOOK_SECRET'),
        topics: ['order/created', 'order/paid', 'order/fulfilled']
    }
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
        },
        prefix: 'cache:17track:'
    }
};

module.exports = {
    REDIS_CONFIG,
    TRACKING_CONFIG,
    WHATSAPP_CONFIG,
    NUVEMSHOP_CONFIG
};
