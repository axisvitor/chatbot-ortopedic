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
        'segunda-feira': { start: '08:00', end: '18:00' },
        'terça-feira': { start: '08:00', end: '18:00' },
        'quarta-feira': { start: '08:00', end: '18:00' },
        'quinta-feira': { start: '08:00', end: '18:00' },
        'sexta-feira': { start: '08:00', end: '18:00' },
        'sábado': null,
        'domingo': null
    },
    holidays: [
        '2024-01-01', // Ano Novo
        '2024-02-12', // Carnaval
        '2024-02-13', // Carnaval
        '2024-03-29', // Sexta-feira Santa
        '2024-04-21', // Tiradentes
        '2024-05-01', // Dia do Trabalho
        '2024-05-30', // Corpus Christi
        '2024-09-07', // Independência
        '2024-10-12', // Nossa Senhora Aparecida
        '2024-11-02', // Finados
        '2024-11-15', // Proclamação da República
        '2024-12-25'  // Natal
    ],
    messages: {
        outOfHours: 'Nosso atendimento financeiro funciona de Segunda-feira a Sexta-feira, das 8h às 18h. Por favor, retorne durante nosso horário de atendimento.',
        holiday: 'Hoje é feriado. Nosso próximo atendimento será no próximo dia útil a partir das 8h.',
        weekend: 'Não há expediente aos finais de semana. Nosso próximo atendimento será Segunda-feira a partir das 8h.'
    }
};

module.exports = {
    OPENAI_CONFIG,
    GROQ_CONFIG,
    REDIS_CONFIG,
    WHATSAPP_CONFIG,
    TRACKING_CONFIG,
    BUSINESS_HOURS
};
