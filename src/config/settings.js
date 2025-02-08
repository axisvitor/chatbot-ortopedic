require('dotenv').config();

// Valores padrão para desenvolvimento
const DEFAULT_VALUES = {
    PORT: '3000',
    LOG_LEVEL: 'info',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: '',
    OPENAI_API_KEY: 'dummy_key',
    ASSISTANT_ID: 'dummy_assistant',
    WAPI_URL: 'https://host06.serverapi.dev',
    WAPI_TOKEN: 'wi7n6IE2TRn5CaX4HK3vK3ZBH9uaYU4b8',
    WAPI_CONNECTION_KEY: 'w-api_n4FDjWRWo5',
    NUVEMSHOP_ACCESS_TOKEN: 'dummy_token',
    NUVEMSHOP_API_URL: 'https://api.nuvemshop.com.br/v1/dummy_id',
    NUVEMSHOP_USER_ID: 'dummy_user',
    NUVEMSHOP_SCOPE: 'read_content,read_products,read_orders',
    FINANCIAL_DEPT_NUMBER: '5594991307744',
    SUPPORT_DEPT_NUMBER: '123457',
    SALES_DEPT_NUMBER: '123458',
    TECHNICAL_DEPT_NUMBER: '5594991307744',
    TRACK17_API_KEY: 'dummy_key',
    TRACK17_API_URL: 'https://api.17track.net/v2',
    TRACK17_REGISTER_PATH: '/register',
    TRACK17_STATUS_PATH: '/status',
    TRACK17_TRACK_PATH: '/track',
    TRACK17_PUSH_PATH: '/push',
    TRACK17_WEBHOOK_SECRET: 'dummy_secret',
    WHATSAPP_NUMBER: '',
    FFMPEG_PATH: './node_modules/ffmpeg-static/ffmpeg'
};

// Redis Configuration
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || DEFAULT_VALUES.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || DEFAULT_VALUES.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || DEFAULT_VALUES.REDIS_PASSWORD,
    ttl: {
        tracking: {
            default: 2592000,    // 30 dias
            orders: 2592000,     // 30 dias
            updates: 2592000,    // 30 dias
            status: 300          // 5 minutos
        },
        ortopedic: {
            products: 604800,    // 7 dias
            cache: 3600         // 1 hora
        },
        openai: {
            threads: 2592000,    // 30 dias
            context: 432000,     // 5 dias
        }
    },
    retryStrategy(retries) {
        // Retorna um atraso aleatório entre 0 e 3 segundos
        return Math.floor(Math.random() * 3000);
    }
};

// Nuvemshop Configuration
const NUVEMSHOP_CONFIG = {
    // Configurações da API
    apiUrl: process.env.NUVEMSHOP_API_URL || DEFAULT_VALUES.NUVEMSHOP_API_URL,
    appId: process.env.NUVEMSHOP_USER_ID || DEFAULT_VALUES.NUVEMSHOP_USER_ID,
    accessToken: process.env.NUVEMSHOP_ACCESS_TOKEN || DEFAULT_VALUES.NUVEMSHOP_ACCESS_TOKEN,
    scope: process.env.NUVEMSHOP_SCOPE || DEFAULT_VALUES.NUVEMSHOP_SCOPE,
    api: {
        timeout: parseInt(process.env.REQUEST_TIMEOUT || 30000),
        retryAttempts: 3,
        retryDelays: [100, 300, 500],
        userAgent: 'API Loja Ortopedic (suporte@lojaortopedic.com.br)'
    },
    // Configurações do cache
    cacheKey: {
        products: 'nuvemshop:products',
    },
    // Funções para gerar URLs
    chatUrl() {
        return `https://www.nuvemshop.com.br/apps/${this.appId}/admin/chat`;
    },
    embeddingsUrl() {
        return `https://www.nuvemshop.com.br/apps/${this.appId}/admin/embeddings`;
    },
    visionUrl() {
        return `https://www.nuvemshop.com.br/apps/${this.appId}/admin/vision`;
    },
    audioUrl() {
        return `https://www.nuvemshop.com.br/apps/${this.appId}/admin/audio`;
    }
};

// Rate Limit Configuration
const RATE_LIMIT_CONFIG = {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Limitar cada IP a 100 requisições por janela de 15 minutos
    standardHeaders: true, // Retorna informações de limite de taxa nos cabeçalhos `RateLimit-*`
    legacyHeaders: false, // Desativa os cabeçalhos `X-RateLimit-*`
};

// Configurações de Logging
const LOGGING_CONFIG = {
    level: process.env.LOG_LEVEL || 'info',
};

// Configurações de Timeout
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || 30000);

// Configurações do FFMPEG
const FFMPEG_CONFIG = {
    path: process.env.FFMPEG_PATH || DEFAULT_VALUES.FFMPEG_PATH
};

const MEDIA_CONFIG = {
    maxSize: parseInt(process.env.MEDIA_MAX_SIZE || 26214400),
    tempDir: process.env.MEDIA_TEMP_DIR || './temp'
};

const CACHE_CONFIG = {
    ttl: {
        tracking: {
            default: 2592000,    // 30 dias
            orders: 2592000,     // 30 dias
            updates: 2592000,    // 30 dias
            status: 300          // 5 minutos
        },
        ortopedic: {
            products: 604800,    // 7 dias
            cache: 3600         // 1 hora
        },
        openai: {
            threads: 2592000,    // 30 dias
            context: 432000,     // 5 dias
        }
    },
};

const GROQ_CONFIG = {
    api_key: process.env.GROQ_API_KEY,
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'mixtral-8x7b-32768'
};

const WHATSAPP_CONFIG = {
    url: process.env.WAPI_URL,
    token: process.env.WAPI_TOKEN,
    connection_key: process.env.WAPI_CONNECTION_KEY
};

const TRACKING_CONFIG = {
    url: process.env.TRACK17_API_URL,
    apiKey: process.env.TRACK17_API_KEY,
    registerPath: process.env.TRACK17_REGISTER_PATH,
    statusPath: process.env.TRACK17_STATUS_PATH,
    trackPath: process.env.TRACK17_TRACK_PATH,
    pushPath: process.env.TRACK17_PUSH_PATH,
    webhookSecret: process.env.TRACK17_WEBHOOK_SECRET
};

const ANTHROPIC_CONFIG = {
    apiKey: process.env.ANTHROPIC_API_KEY
};

const BUSINESS_HOURS = {
    timezone: 'America/Sao_Paulo',
    schedule: {
        domingo: null,
        segunda: { start: '08:00', end: '18:00' },
        terca: { start: '08:00', end: '18:00' },
        quarta: { start: '08:00', end: '18:00' },
        quinta: { start: '08:00', end: '18:00' },
        sexta: { start: '08:00', end: '18:00' },
        sabado: null
    }
};

module.exports = {
    REDIS_CONFIG,
    NUVEMSHOP_CONFIG,
    RATE_LIMIT_CONFIG,
    LOGGING_CONFIG,
    REQUEST_TIMEOUT,
    FFMPEG_CONFIG,
    MEDIA_CONFIG,
    CACHE_CONFIG,
    GROQ_CONFIG,
    WHATSAPP_CONFIG,
    TRACKING_CONFIG,
    ANTHROPIC_CONFIG,
    BUSINESS_HOURS
};
