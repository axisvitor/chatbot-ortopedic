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
    assistantId: validateEnvVar('ASSISTANT_ID'),
    baseUrl: 'https://api.openai.com/v1',
    models: {
        chat: 'gpt-4o',
        vision: 'gpt-4o'
    },
    visionConfig: {
        max_tokens: 1024,
        temperature: 0.2,
        detail: "high"
    }
};

// Groq Configuration
const GROQ_CONFIG = {
    apiKey: validateEnvVar('GROQ_API_KEY'),
    models: {
        vision: 'llama-3.2-90b-vision-preview',
        audio: 'whisper-large-v3-turbo',
        chat: 'llama-3.2-90b-chat'
    },
    audioConfig: {
        language: 'pt',
        response_format: 'text',
        temperature: 0.0
    },
    baseUrl: 'https://api.groq.com/openai/v1',
    get chatUrl() { return `${this.baseUrl}/chat/completions` },
    get embeddingsUrl() { return `${this.baseUrl}/embeddings` },
    get visionUrl() { return `${this.baseUrl}/chat/completions` },
    get audioUrl() { return `${this.baseUrl}/audio/transcriptions` }
};

// Redis Configuration
const REDIS_CONFIG = {
    host: validateEnvVar('REDIS_HOST'),
    port: validateEnvVar('REDIS_PORT'),
    password: validateEnvVar('REDIS_PASSWORD'),
    ttl: 30 * 24 * 60 * 60, // 30 days
    prefix: 'ecommerce:'
};

// WhatsApp Configuration
const WHATSAPP_CONFIG = {
    apiUrl: validateEnvVar('WAPI_URL'),
    token: validateEnvVar('WAPI_TOKEN'),
    connectionKey: validateEnvVar('WAPI_CONNECTION_KEY'),
    messageDelay: 3000, // delay padrão entre mensagens em ms
    retryAttempts: 3,
    retryDelay: 1000,
    connectionTimeout: 30000,
    qrTimeout: 60000,
    reconnectInterval: 5000,
    maxReconnectAttempts: 5,
    messageOptions: {
        quoted: true,
        sendSeen: true,
        waitForAck: true
    },
    downloadOptions: {
        maxRetries: 3,
        timeout: 30000
    },
    endpoints: {
        text: {
            path: 'message/send-text',
            method: 'POST',
            params: {
                to: 'phoneNumber',
                content: 'text',
                delay: 'delayMessage'
            }
        },
        image: {
            path: 'message/send-image',
            method: 'POST',
            params: {
                to: 'phoneNumber',
                content: 'image',
                caption: 'caption',
                delay: 'delayMessage'
            }
        },
        document: {
            path: 'message/send-document',
            method: 'POST',
            params: {
                to: 'phoneNumber',
                content: 'url',
                filename: 'filename'
            }
        },
        audio: {
            path: 'message/send-audio',
            method: 'POST',
            params: {
                to: 'phoneNumber',
                content: 'audioUrl'
            }
        },
        media: {
            path: 'media/upload',
            method: 'POST'
        }
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
        domingo: null,
        segunda: { start: '08:00', end: '18:00' },
        terca: { start: '08:00', end: '18:00' },
        quarta: { start: '08:00', end: '18:00' },
        quinta: { start: '08:00', end: '18:00' },
        sexta: { start: '08:00', end: '18:00' },
        sabado: { start: '08:00', end: '12:00' }
    },
    holidays: [
        // Feriados fixos
        '2025-01-01', // Ano Novo
        '2025-04-21', // Tiradentes
        '2025-05-01', // Dia do Trabalho
        '2025-09-07', // Independência
        '2025-10-12', // Nossa Senhora
        '2025-11-02', // Finados
        '2025-11-15', // Proclamação da República
        '2025-12-25'  // Natal
    ],
    messages: {
        outOfHours: "Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. Por favor, envie sua mensagem durante o horário comercial.",
        holiday: "Hoje é feriado. Por favor, envie sua mensagem em um dia útil.",
        weekend: "Não há atendimento aos finais de semana. Retornaremos na {NEXT_DAY}.",
        outsideHours: "Nosso horário de atendimento é das {START_TIME} às {END_TIME}. Por favor, envie sua mensagem durante o horário comercial.",
        humanSupport: "Um atendente irá ajudá-lo em breve.",
        financialDepartment: "Sua mensagem foi encaminhada para o departamento financeiro. Em breve entraremos em contato."
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
    apiUrl: validateEnvVar('NUVEMSHOP_API_URL'),
    api: {
        timeout: 30000,          // 30 segundos
        retryAttempts: 3,
        retryDelays: [1000, 3000, 5000], // 1s, 3s, 5s
        rateLimit: {
            maxRequests: 10,     // 10 requisições
            perMilliseconds: 1000, // por segundo
            maxRPS: 10
        },
        userAgent: 'API Loja Ortopedic (suporte@lojaortopedic.com.br)'
    },
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
        }
    },
    webhook: {
        retryAttempts: 18,       // Conforme documentação
        retryDelays: [0, 300, 600, 900], // 0s, 5min, 10min, 15min
        timeout: 10000,          // 10 segundos conforme documentação
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
    }
};

// FFmpeg Configuration
const FFMPEG_CONFIG = {
    path: process.env.FFMPEG_PATH || './node_modules/ffmpeg-static/ffmpeg',
    options: {
        audioFormat: 'wav',
        sampleRate: 16000,
        channels: 1,
        codec: 'pcm_s16le'
    }
};

// Rate Limit Configuration
const RATE_LIMIT_CONFIG = {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Limite de 100 requisiç��es por janela
    message: "Muitas requisições, por favor, tente novamente mais tarde."
};

// Logging Configuration
const LOGGING_CONFIG = {
    enabled: true,
    level: 'debug',
    format: {
        timestamp: true,
        colorize: true,
        json: false
    },
    webhook: {
        request: true,
        response: true,
        headers: true
    },
    whatsapp: {
        requests: true,
        responses: true,
        errors: true
    },
    ai: {
        requests: true,
        responses: true,
        timing: true
    },
    redis: {
        operations: true,
        errors: true
    }
};

// Cache Configuration
const CACHE_CONFIG = {
    prefix: 'cache:',
    orderTTL: 24 * 60 * 60, // 24 horas em segundos
    customerTTL: 7 * 24 * 60 * 60, // 7 dias em segundos
    productTTL: 24 * 60 * 60, // 24 horas em segundos
    trackingTTL: 12 * 60 * 60 // 12 horas em segundos
};

// Required Environment Variables
const REQUIRED_ENV_VARS = [
    'OPENAI_API_KEY',
    'ASSISTANT_ID',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
    'WAPI_URL',
    'WAPI_TOKEN',
    'WAPI_CONNECTION_KEY',
    'NUVEMSHOP_ACCESS_TOKEN',
    'NUVEMSHOP_USER_ID',
    'NUVEMSHOP_SCOPE',
    'NUVEMSHOP_API_URL',
    'TRACK17_API_KEY'  // Adicionando TRACK17_API_KEY
];

module.exports = {
    OPENAI_CONFIG,
    GROQ_CONFIG,
    REDIS_CONFIG,
    RATE_LIMIT_CONFIG,
    BUSINESS_HOURS,
    NUVEMSHOP_CONFIG,
    WHATSAPP_CONFIG,
    TRACKING_CONFIG,
    REQUIRED_ENV_VARS
};
