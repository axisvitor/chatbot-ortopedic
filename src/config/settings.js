require('dotenv').config();

// Função para validar variáveis de ambiente
function validateEnvVar(name, defaultValue = undefined) {
    const value = process.env[name];
    
    // Se tiver valor, retorna ele
    if (value) return value;
    
    // Se não tiver valor mas tiver um padrão, retorna o padrão
    if (defaultValue !== undefined) return defaultValue;
    
    // Se não tiver valor nem padrão, lança erro
    throw new Error(`Environment variable ${name} is required`);
}

// Primeiro define o NODE_ENV
const NODE_ENV = validateEnvVar('NODE_ENV', 'development');

// Valores padrão para desenvolvimento
const DEFAULT_VALUES = {
    PORT: '3000',
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
    'NUVEMSHOP_USER_ID',
    'NUVEMSHOP_SCOPE',
    'FINANCIAL_DEPT_NUMBER',
    'SUPPORT_DEPT_NUMBER',
    'SALES_DEPT_NUMBER',
    'TECHNICAL_DEPT_NUMBER',
    'TRACK17_API_KEY',
    'TRACK17_API_URL',
    'TRACK17_REGISTER_PATH',
    'TRACK17_STATUS_PATH',
    'TRACK17_TRACK_PATH',
    'TRACK17_PUSH_PATH',
    'TRACK17_WEBHOOK_SECRET',
    'WHATSAPP_NUMBER',
    'FFMPEG_PATH'
];

// Em desenvolvimento, usa valores padrão
const env = {};
if (NODE_ENV === 'development') {
    REQUIRED_ENV_VARS.forEach(varName => {
        env[varName] = validateEnvVar(varName, DEFAULT_VALUES[varName]);
    });
} else {
    REQUIRED_ENV_VARS.forEach(varName => {
        env[varName] = validateEnvVar(varName);
    });
}

// Exporta variáveis de ambiente validadas
const PORT = parseInt(env.PORT, 10);

// Redis Configuration
const REDIS_CONFIG = {
    host: env.REDIS_HOST,
    port: parseInt(env.REDIS_PORT),
    password: env.REDIS_PASSWORD,
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

// OpenAI Configuration
const OPENAI_CONFIG = {
    apiKey: env.OPENAI_API_KEY,
    assistantId: env.ASSISTANT_ID,
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
    apiKey: env.GROQ_API_KEY,
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

// WhatsApp Configuration
const WHATSAPP_CONFIG = {
    apiUrl: env.WAPI_URL,
    token: env.WAPI_TOKEN,
    connectionKey: env.WAPI_CONNECTION_KEY,
    whatsappNumber: env.TECHNICAL_DEPT_NUMBER,  // Adicionando whatsappNumber
    departments: {
        financial: env.FINANCIAL_DEPT_NUMBER,
        support: env.SUPPORT_DEPT_NUMBER,
        sales: env.SALES_DEPT_NUMBER,
        technical: env.TECHNICAL_DEPT_NUMBER
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
        },
        webhook: {
            path: 'webhook/msg_recebidas_ou_enviadas',
            method: 'POST'
        }
    }
};

// Tracking Configuration
const TRACKING_CONFIG = {
    endpoint: env.TRACK17_API_URL,
    apiKey: env.TRACK17_API_KEY,
    paths: {
        register: env.TRACK17_REGISTER_PATH,
        status: env.TRACK17_STATUS_PATH,
        track: env.TRACK17_TRACK_PATH,
        push: env.TRACK17_PUSH_PATH
    },
    webhookSecret: env.TRACK17_WEBHOOK_SECRET,
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

// Rate Limit Configuration
const RATE_LIMIT_CONFIG = {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limite de 100 requisições por windowMs
    message: 'Muitas requisições deste IP, por favor tente novamente mais tarde.',
    standardHeaders: true,
    legacyHeaders: false
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
    path: env.FFMPEG_PATH,
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

// Nuvemshop Configuration
const NUVEMSHOP_CONFIG = {
    // Configurações da API
    apiUrl: env.NUVEMSHOP_API_URL,
    accessToken: env.NUVEMSHOP_ACCESS_TOKEN,
    userId: env.NUVEMSHOP_USER_ID,
    scope: env.NUVEMSHOP_SCOPE.split(','),
    
    // Configurações do webhook
    webhook: {
        topics: [
            'orders/created',
            'orders/paid',
            'orders/fulfilled',
            'orders/cancelled',
            'orders/updated',
            'products/created',
            'products/updated',
            'products/deleted',
            'customers/created',
            'customers/updated'
        ],
        retryAttempts: 3,
        retryDelay: 1000, // 1 segundo
        timeout: 5000 // 5 segundos
    },

    // Configurações de API
    api: {
        timeout: 30000, // 30 segundos
        retryAttempts: 3,
        retryDelays: [1000, 3000, 5000], // 1s, 3s, 5s
        rateLimit: {
            bucketSize: 40,      // Tamanho máximo do bucket
            requestsPerSecond: 2, // Taxa de 2 requisições por segundo
            headers: {
                limit: 'x-rate-limit-limit',
                remaining: 'x-rate-limit-remaining',
                reset: 'x-rate-limit-reset'
            }
        },
        userAgent: 'API Loja Ortopedic (suporte@lojaortopedic.com.br)'
    },

    // Configurações de cache
    cache: {
        ttl: {
            orders: 3600,        // 1 hora
            products: 7200,      // 2 horas
            customers: 86400,    // 24 horas
            webhooks: 300        // 5 minutos
        },
        prefix: {
            orders: 'nuvemshop:orders:',
            products: 'nuvemshop:products:',
            customers: 'nuvemshop:customers:',
            webhooks: 'nuvemshop:webhooks:'
        }
    },

    // Configurações de segurança
    security: {
        rateLimitWindow: 60000, // 1 minuto
        maxRequestsPerWindow: 100
    },

    // Configurações de validação
    validation: {
        maxOrdersPerPage: 50, // Limite de pedidos por página
        maxProductsPerPage: 100, // Limite de produtos por página
        maxCustomersPerPage: 100, // Limite de clientes por página
        orderStatuses: ['open', 'closed', 'cancelled'],
        requiredFields: {
            orders: ['id', 'number', 'status', 'shipping_tracking', 'created_at'],
            products: ['id', 'title', 'handle', 'variants'],
            customers: ['id', 'name', 'email']
        }
    },

    // Configurações de internacionalização
    i18n: {
        defaultLanguage: 'pt-BR',
        supportedLanguages: ['pt-BR', 'es', 'en']
    }
};

module.exports = {
    PORT,
    REDIS_CONFIG,
    OPENAI_CONFIG,
    GROQ_CONFIG,
    WHATSAPP_CONFIG,
    TRACKING_CONFIG,
    BUSINESS_HOURS,
    MEDIA_CONFIG,
    NUVEMSHOP_CONFIG,
    RATE_LIMIT_CONFIG
};
