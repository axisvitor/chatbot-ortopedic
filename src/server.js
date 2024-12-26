const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const bodyParser = require('body-parser');
const { RedisStore } = require('./store/redis-store');

// Importa todos os serviços do arquivo centralizado
const {
    GroqServices,
    WebhookService,
    WhatsAppService,
    AIServices,
    AudioService,
    WhatsAppImageService,
    ImageService,
    BusinessHoursService,
    OrderValidationService,
    NuvemshopService,
    TrackingService,
    CacheService,
    MediaManagerService
} = require('./services');

// Configurações
const { 
    RATE_LIMIT_CONFIG,
    REDIS_CONFIG,
    BUSINESS_HOURS,
    REQUIRED_ENV_VARS
} = require('./config/settings');

// Lista de variáveis de ambiente requeridas
const requiredEnvVars = [
    ...REQUIRED_ENV_VARS,
    'PORT',
    'NODE_ENV'
];

// Inicializa o Redis Store
const redisStore = new RedisStore();

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', {
        erro: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
    });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada não tratada:', {
        razao: reason,
        timestamp: new Date().toISOString()
    });
});

process.on('SIGTERM', async () => {
    console.log('🛑 Recebido sinal SIGTERM, encerrando graciosamente...');
    try {
        if (whatsappService) await whatsappService.close();
        await redisStore.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro ao encerrar servidor:', error);
        process.exit(1);
    }
});

console.log('🚀 Iniciando servidor...');

// Inicializa o app
const app = express();
const port = process.env.PORT || 8080;

console.log(`📝 Porta configurada: ${port}`);

// Variáveis de estado
let isReady = false;
let initError = null;

// Declaração dos serviços
let groqServices;
let webhookService;
let whatsappService;
let aiServices;
let audioService;
let imageService;
let whatsappImageService;
let orderValidationService;
let nuvemshopService;
let trackingService;
let cacheService;
let mediaManagerService;
let businessHoursService;

// Função de inicialização
async function initializeServices() {
    return new Promise(async (resolve, reject) => {
        // Timeout de 30 segundos para inicialização
        const timeout = setTimeout(() => {
            const error = new Error('Timeout ao inicializar serviços');
            console.error('❌ ', error);
            reject(error);
        }, 30000);

        try {
            console.log('🔄 Iniciando serviços...');
            
            // Verifica variáveis de ambiente
            for (const envVar of requiredEnvVars) {
                if (!process.env[envVar]) {
                    throw new Error(`Variável de ambiente ${envVar} não definida`);
                }
            }

            // Inicializa serviços base
            redisStore.connect();
            console.log('✅ RedisStore conectado');

            cacheService = new CacheService(redisStore);
            console.log('✅ CacheService inicializado');
            
            // Inicializa o WhatsAppService primeiro
            whatsappService = new WhatsAppService();
            await whatsappService.init();
            const client = await whatsappService.getClient();
            if (!client) {
                throw new Error('WhatsAppService não inicializou corretamente');
            }
            console.log('✅ WhatsAppService inicializado');

            // Inicializa serviços de mídia
            groqServices = new GroqServices();
            console.log('✅ GroqServices inicializado');
            
            audioService = new AudioService(groqServices, whatsappService);
            console.log('✅ AudioService inicializado');
            
            whatsappImageService = new WhatsAppImageService();
            console.log('✅ WhatsAppImageService inicializado');

            imageService = new ImageService(groqServices, whatsappService);
            console.log('✅ ImageService inicializado');

            mediaManagerService = new MediaManagerService(audioService, imageService);
            console.log('✅ MediaManagerService inicializado');

            // Inicializa serviços de negócio
            businessHoursService = new BusinessHoursService();
            console.log('✅ BusinessHoursService inicializado');

            nuvemshopService = new NuvemshopService(cacheService);
            console.log('✅ NuvemshopService inicializado');

            trackingService = new TrackingService();
            console.log('✅ TrackingService inicializado');

            orderValidationService = new OrderValidationService();
            console.log('✅ OrderValidationService inicializado');

            webhookService = new WebhookService();
            console.log('✅ WebhookService inicializado');
            
            // Inicializa o AIServices com todas as dependências
            aiServices = new AIServices(
                whatsappService,
                whatsappImageService,
                redisStore,
                null, // openAIService não é mais usado
                trackingService,
                orderValidationService,
                nuvemshopService,
                audioService,
                imageService,
                businessHoursService
            );
            console.log('✅ AIServices inicializado');

            clearTimeout(timeout);
            isReady = true;
            resolve();
        } catch (error) {
            clearTimeout(timeout);
            console.error('❌ Erro ao inicializar serviços:', error);
            initError = error;
            reject(error);
        }
    });
}

// Middlewares
app.use(helmet());
app.use(morgan('dev'));
app.use(cors());
app.use(bodyParser.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.windowMs,
    max: RATE_LIMIT_CONFIG.maxRequests,
    message: 'Muitas requisições deste IP, por favor tente novamente mais tarde.'
});

app.use('/webhook', limiter);

// Middleware de verificação de prontidão
app.use((req, res, next) => {
    if (!isReady && req.path !== '/health') {
        return res.status(503).json({
            status: 'error',
            message: 'Serviço ainda não está pronto',
            error: initError?.message
        });
    }
    next();
});

// Rotas
app.get('/health', (req, res) => {
    const status = isReady ? 'ok' : 'initializing';
    const error = initError?.message;
    
    res.json({
        status,
        error,
        services: {
            whatsapp: !!whatsappService,
            redis: redisStore.isConnected(),
            ai: !!aiServices,
            webhook: !!webhookService
        },
        timestamp: new Date().toISOString()
    });
});

app.post('/webhook/msg_recebidas_ou_enviadas', async (req, res) => {
    try {
        console.log('📥 Webhook recebido:', {
            headers: req.headers,
            tipo: req.body?.type,
            timestamp: new Date().toISOString()
        });

        if (!webhookService) {
            throw new Error('WebhookService não inicializado');
        }

        await webhookService.handleWebhook(req.body);
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Erro ao processar webhook:', error);
        res.status(500).json({
            status: 'error',
            message: 'Erro ao processar webhook',
            error: error.message
        });
    }
});

// Função para iniciar o servidor
async function startServer(maxRetries = 3) {
    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            await initializeServices();
            
            app.listen(port, () => {
                console.log(`🚀 Servidor rodando na porta ${port}`);
                console.log('✅ Todos os serviços inicializados com sucesso');
            });
            
            return;
        } catch (error) {
            retries++;
            console.error(`❌ Tentativa ${retries}/${maxRetries} falhou:`, error);
            
            if (retries === maxRetries) {
                console.error('❌ Número máximo de tentativas atingido. Encerrando...');
                process.exit(1);
            }
            
            // Espera 5 segundos antes da próxima tentativa
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Exporta para uso em testes
module.exports = { app, startServer };

// Se executado diretamente, inicia o servidor
if (require.main === module) {
    startServer().catch(error => {
        console.error('❌ Erro fatal ao iniciar servidor:', error);
        process.exit(1);
    });
}
