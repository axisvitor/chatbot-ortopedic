require('dotenv').config();

function validateEnvVar(name) {
    if (!process.env[name]) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return process.env[name];
}

// OpenAI Configuration
const OPENAI_CONFIG = {
    apiKey: validateEnvVar('OPENAI_API_KEY'),
    assistantId: validateEnvVar('ASSISTANT_ID')
};

// Groq Configuration
const GROQ_CONFIG = {
    apiKey: validateEnvVar('GROQ_API_KEY'),
    models: {
        vision: 'llama-3.2-90b-vision-preview',
        audio: 'whisper-large-v3',
        chat: 'llama-3.2-90b-chat'
    },
    audioConfig: {
        language: 'pt',
        response_format: 'text',
        temperature: 0.0
    }
};

// Redis Configuration
const REDIS_CONFIG = {
    host: validateEnvVar('REDIS_HOST'),
    port: validateEnvVar('REDIS_PORT'),
    password: validateEnvVar('REDIS_PASSWORD'),
    ttl: 86400, // 24 hours
    prefix: 'ecommerce:'
};

// WhatsApp Configuration
const WHATSAPP_CONFIG = {
    apiUrl: validateEnvVar('WAPI_URL'),
    token: validateEnvVar('WAPI_TOKEN'),
    connectionKey: validateEnvVar('WAPI_CONNECTION_KEY'),
    messageDelay: 1000, // delay entre mensagens em ms
    retryAttempts: 3,
    endpoints: {
        text: 'message/send-text',
        image: 'message/send-image',
        document: 'message/send-document',
        audio: 'message/send-audio',
        status: 'message/status'
    },
    departments: {
        financial: {
            number: validateEnvVar('FINANCIAL_DEPT_NUMBER'),
            paymentProofs: {
                allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
                maxSize: 5 * 1024 * 1024 // 5MB
            }
        }
    }
};

// 17Track Configuration
const TRACKING_CONFIG = {
    apiKey: validateEnvVar('TRACK17_API_KEY'),
    endpoint: 'api.17track.net',
    paths: {
        register: '/track/v2.2/register',
        status: '/track/v2.2/gettracklist'
    },
    updateInterval: 3600000, // 1 hora em ms
    carriers: ['correios', 'jadlog', 'fedex', 'dhl']
};

// Business Hours Configuration
const BUSINESS_HOURS = {
    timezone: 'America/Sao_Paulo',
    schedule: {
        monday: { start: '09:00', end: '18:00' },
        tuesday: { start: '09:00', end: '18:00' },
        wednesday: { start: '09:00', end: '18:00' },
        thursday: { start: '09:00', end: '18:00' },
        friday: { start: '09:00', end: '18:00' },
        saturday: { start: null, end: null },
        sunday: { start: null, end: null },
    },
    messages: {
        outOfHours: "Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. Por favor, envie sua mensagem durante o horário comercial."
    }
};

// Media Processing Configuration
const MEDIA_CONFIG = {
    audio: {
        maxDuration: 300, // 5 minutos
        maxSize: 10 * 1024 * 1024, // 10MB
        allowedTypes: ['audio/ogg', 'audio/mpeg', 'audio/mp4'],
        compression: {
            codec: 'libmp3lame',
            bitrate: '64k',
            channels: 1,
            sampleRate: 16000
        },
        cache: {
            ttl: 7 * 24 * 60 * 60, // 7 dias
            prefix: 'audio_cache:'
        }
    },
    image: {
        maxSize: 5 * 1024 * 1024, // 5MB
        maxDimension: 2048, // pixels
        allowedTypes: ['image/jpeg', 'image/png'],
        compression: {
            quality: 80,
            progressive: true
        },
        cache: {
            ttl: 7 * 24 * 60 * 60, // 7 dias
            prefix: 'image_cache:'
        },
        security: {
            signatures: {
                'ffd8ffe0': 'image/jpeg', // JPEG
                '89504e47': 'image/png'   // PNG
            },
            maxValidationAttempts: 3
        }
    },
    metrics: {
        enabled: true,
        retention: 30 * 24 * 60 * 60, // 30 dias
        prefix: 'media_metrics:'
    }
};

// Nuvemshop Configuration
const NUVEMSHOP_CONFIG = {
    accessToken: validateEnvVar('NUVEMSHOP_ACCESS_TOKEN'),
    userId: validateEnvVar('NUVEMSHOP_USER_ID'),
    scope: validateEnvVar('NUVEMSHOP_SCOPE').split(','),
    cache: {
        prefix: 'nuvemshop:',
        ttl: {
            default: 3600,        // 1 hora
            products: 3600,       // 1 hora
            categories: 86400,    // 24 horas
            orders: {
                recent: 300,      // 5 minutos para pedidos recentes
                old: 3600,        // 1 hora para pedidos antigos
                details: 1800     // 30 minutos para detalhes do pedido
            },
            customers: 1800,      // 30 minutos
            inventory: 300,       // 5 minutos
            shipping: 1800,       // 30 minutos
            payments: 1800        // 30 minutos
        },
        invalidation: {
            maxKeys: 1000,        // Máximo de chaves a serem invalidadas por vez
            batchSize: 100        // Tamanho do lote para invalidação em massa
        }
    },
    api: {
        url: validateEnvVar('NUVEMSHOP_API_URL'),
        timeout: 30000,
        retryAttempts: 3,
        userAgent: 'API Loja Ortopedic (suporte@lojaortopedic.com.br)'
    },
    webhook: {
        retryAttempts: 18, // Conforme documentação
        retryDelays: [0, 300, 600, 900], // 0s, 5min, 10min, 15min
        timeout: 10000, // 10 segundos conforme documentação
        events: {
            app: ['uninstalled', 'suspended', 'resumed'],
            category: ['created', 'updated', 'deleted'],
            order: [
                'created', 'updated', 'paid', 'packed', 
                'fulfilled', 'cancelled', 'custom_fields_updated', 
                'edited', 'pending', 'voided'
            ],
            product: ['created', 'updated', 'deleted'],
            productVariant: ['custom_fields_updated'],
            domain: ['updated'],
            orderCustomField: ['created', 'updated', 'deleted'],
            productVariantCustomField: ['created', 'updated', 'deleted'],
            store: ['redact'],
            customers: ['redact', 'data_request']
        }
    },
    rateLimit: {
        bucketSize: 40, // Tamanho padrão do bucket
        leakRate: 2,    // Taxa de vazamento (requests por segundo)
        nextPlanMultiplier: 10, // Multiplicador para planos Next/Evolution
    }
};

const RATE_LIMIT_CONFIG = {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Limite de 100 requisiç��es por janela
    message: "Muitas requisições, por favor, tente novamente mais tarde."
};

module.exports = {
    OPENAI_CONFIG,
    GROQ_CONFIG,
    REDIS_CONFIG,
    WHATSAPP_CONFIG,
    TRACKING_CONFIG,
    BUSINESS_HOURS,
    MEDIA_CONFIG,
    NUVEMSHOP_CONFIG,
    RATE_LIMIT_CONFIG
};
