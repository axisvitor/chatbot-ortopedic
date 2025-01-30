require('dotenv').config();

// Função para validar variáveis de ambiente
function validateEnvVar(name) {
    if (!process.env[name]) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return process.env[name];
}

// Validar variáveis de ambiente obrigatórias
const REQUIRED_ENV_VARS = [
    'NODE_ENV',
    'PORT',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
    'OPENAI_API_KEY',
    'ASSISTANT_ID',
    'WAPI_URL',
    'WAPI_TOKEN',
    'WAPI_CONNECTION_KEY',
    'NUVEMSHOP_ACCESS_TOKEN',
    'NUVEMSHOP_API_URL',
    'NUVEMSHOP_STORE_ID',
    'FINANCIAL_DEPT_NUMBER',
    'TRACK17_API_KEY',
    'TRACK17_API_URL',
    'TRACK17_REGISTER_PATH',
    'TRACK17_STATUS_PATH',
    'TRACK17_TRACK_PATH',
    'TRACK17_PUSH_PATH'
];

// Validar todas as variáveis obrigatórias
REQUIRED_ENV_VARS.forEach(validateEnvVar);

// Redis Configuration
const REDIS_CONFIG = {
    host: validateEnvVar('REDIS_HOST') || 'localhost',
    port: parseInt(validateEnvVar('REDIS_PORT') || '6379'),
    password: validateEnvVar('REDIS_PASSWORD'),
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
            metadata: 2592000    // 30 dias
        },
        ecommerce: {
            processed: 2592000,  // 30 dias
            cache: 3600         // 1 hora
        },
        chat: {
            history: 2592000,    // 30 dias
            session: 86400      // 24 horas
        },
        processing: 2592000,    // 30 dias
        context: 432000,        // 5 dias
        waiting: 2592000,       // 30 dias
        assistant: 2592000      // 30 dias
    },
    prefix: {
        tracking: 'loja:tracking:',
        ortopedic: 'loja:ortopedic:',
        openai: 'loja:openai:',
        ecommerce: 'loja:ecommerce:',
        chat: 'loja:chat:',
        thread: 'loja:thread:',
        thread_metadata: 'loja:thread_metadata:',
        processing: 'loja:processing:',
        context: 'loja:context:',
        customer_thread: 'loja:customer_thread:',
        waiting: 'loja:waiting_since:',
        assistant: 'loja:assistant:',
        run: 'loja:run:'
    },
    retryStrategy: (retries) => {
        if (retries > 10) return new Error('Máximo de tentativas de reconexão excedido');
        return Math.min(retries * 100, 3000);
    }
};

// Nuvemshop Configuration
const NUVEMSHOP_CONFIG = {
    // Configurações da API
    apiUrl: process.env.NUVEMSHOP_API_URL || 'https://api.nuvemshop.com.br/v1',
    accessToken: process.env.NUVEMSHOP_ACCESS_TOKEN,
    userId: process.env.NUVEMSHOP_USER_ID,
    scope: process.env.NUVEMSHOP_SCOPE?.split(','),
    
    // Configurações do webhook
    webhook: {
        secret: process.env.NUVEMSHOP_WEBHOOK_SECRET,
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

    // Configurações de API
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

    // Configurações de formatação
    formatting: {
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
        allowedIps: process.env.NUVEMSHOP_ALLOWED_IPS?.split(',') || [],
        rateLimitWindow: 60000, // 1 minuto
        maxRequestsPerWindow: 100
    }
};

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

// Rate Limit Configuration
const RATE_LIMIT_CONFIG = {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limite de 100 requisições por windowMs
    message: 'Muitas requisições deste IP, por favor tente novamente mais tarde.',
    standardHeaders: true,
    legacyHeaders: false
};

// WhatsApp Configuration
const WHATSAPP_CONFIG = {
    apiUrl: validateEnvVar('WAPI_URL'),
    token: validateEnvVar('WAPI_TOKEN'),
    connectionKey: validateEnvVar('WAPI_CONNECTION_KEY'),
    departments: {
        financial: validateEnvVar('FINANCIAL_DEPT_NUMBER'),
        support: validateEnvVar('SUPPORT_DEPT_NUMBER'),
        sales: validateEnvVar('SALES_DEPT_NUMBER'),
        technical: validateEnvVar('TECHNICAL_DEPT_NUMBER')
    },
    messageDelay: 3000, // delay padrão entre mensagens em ms
    retryAttempts: 3,
    retryDelay: 1000,
    connectionTimeout: 60000,
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
        },
        connection: {
            path: 'instance/info',
            method: 'GET'
        }
    },
    whatsappNumber: process.env.WHATSAPP_NUMBER || '',  
};

// 17track Configuration
const TRACKING_CONFIG = {
    // API Configuration
    endpoint: process.env.TRACK17_API_URL || 'https://api.17track.net/track/v2',
    apiKey: validateEnvVar('TRACK17_API_KEY'),
    
    // API Paths
    paths: {
        track: '/track/get',
        register: '/track/register',
        push: '/push/get',
        webhook: '/webhook'
    },

    // Supported Carriers
    carriers: [
        'correios',
        'jadlog',
        'sequoia',
        'total',
        'fedex',
        'dhl',
        'ups'
    ],

    // API Limits
    limits: {
        maxTrackingNumbers: 40,
        maxRequestsPerHour: 1000,
        maxWebhooksPerDay: 10000
    },

    // Webhook Configuration
    webhook: {
        secret: process.env.TRACK17_WEBHOOK_SECRET,
        events: [
            'tracking.created',
            'tracking.updated',
            'tracking.delivered',
            'tracking.exception'
        ]
    },

    // Cache Configuration
    cache: {
        prefix: 'track17:',
        ttl: {
            tracking: 300,       // 5 minutos
            register: 3600,      // 1 hora
            push: 300,          // 5 minutos
            webhook: 86400      // 24 horas
        }
    },

    // Retry Configuration
    retry: {
        attempts: 3,
        backoff: {
            min: 1000,          // 1 segundo
            max: 5000,          // 5 segundos
            factor: 2
        }
    }
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

// Cache Configuration
const CACHE_CONFIG = {
    prefix: 'cache:',
    orderTTL: 24 * 60 * 60, // 24 horas em segundos
    customerTTL: 7 * 24 * 60 * 60, // 7 dias em segundos
    productTTL: 24 * 60 * 60, // 24 horas em segundos
    trackingTTL: 12 * 60 * 60 // 12 horas em segundos
};

module.exports = {
    REDIS_CONFIG,
    NUVEMSHOP_CONFIG,
    OPENAI_CONFIG,
    GROQ_CONFIG,
    WHATSAPP_CONFIG,
    TRACKING_CONFIG,
    RATE_LIMIT_CONFIG,
    BUSINESS_HOURS,
    MEDIA_CONFIG,
    LOGGING_CONFIG,
    CACHE_CONFIG,
    FFMPEG_CONFIG
};
