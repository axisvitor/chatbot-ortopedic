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
    'PORT'
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
app.set('trust proxy', req => {
    // Confia apenas em requisições para a rota de health check
    return req.path === '/health';
});
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
            console.log('✅ RedisStore inicializado');

            cacheService = new CacheService(redisStore);
            console.log('✅ CacheService inicializado');
            
            // Inicializa os serviços principais
            const whatsappService = new WhatsAppService();
            console.log('✅ WhatsAppService criado');

            const trackingService = new TrackingService(whatsappService);
            console.log('✅ TrackingService criado');

            const orderValidationService = new OrderValidationService(null, whatsappService);
            console.log('✅ OrderValidationService criado');

            // Inicializa o WhatsApp e aguarda conexão
            await whatsappService.init();
            console.log('✅ WhatsAppService inicializado');

            // Verifica se o cliente está conectado
            const client = await whatsappService.getClient();
            if (!client) {
                throw new Error('WhatsAppService não inicializou corretamente');
            }

            // Inicializa outros serviços
            groqServices = new GroqServices();
            console.log('✅ GroqServices inicializado');

            audioService = new AudioService(groqServices, whatsappService);
            console.log('✅ AudioService inicializado');

            const { WhatsAppImageService } = require('./services/whatsapp-image-service');
            whatsappImageService = new WhatsAppImageService(groqServices);
            console.log('✅ WhatsAppImageService inicializado');

            imageService = new ImageService(whatsappService);
            console.log('✅ ImageService inicializado');

            mediaManagerService = new MediaManagerService(audioService, imageService);
            console.log('✅ MediaManagerService inicializado');

            businessHoursService = new BusinessHoursService();
            console.log('✅ BusinessHoursService inicializado');

            nuvemshopService = new NuvemshopService(cacheService);
            console.log('✅ NuvemshopService inicializado');

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

            webhookService = new WebhookService(whatsappService, aiServices, audioService);
            console.log('✅ WebhookService inicializado');

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

// Aumenta o limite do body-parser para 50MB
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Healthcheck endpoint
app.get('/', async (req, res) => {
    try {
        // Verifica conexão com Redis
        await redisStore.ping();
        
        res.status(200).json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                redis: 'connected'
            }
        });
    } catch (error) {
        console.error('Healthcheck falhou:', error);
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Rota de healthcheck
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

// Rota para enviar mensagens de texto (W-API)
app.post('/message/send-text', async (req, res) => {
    try {
        const { phoneNumber, text, messageId, message, delayMessage } = req.body;

        if (!phoneNumber || !text) {
            return res.status(400).json({
                status: 'error',
                message: 'phoneNumber e text são obrigatórios'
            });
        }

        // Envia a mensagem usando o WhatsAppService que já está configurado com as credenciais da W-API
        const response = await whatsappService.sendText(phoneNumber, text);

        res.status(200).json(response);
    } catch (error) {
        console.error('❌ Erro ao enviar mensagem:', error);
        res.status(500).json({
            status: 'error',
            message: 'Erro ao enviar mensagem',
            error: error.message
        });
    }
});

const { OrderStatusSyncJob } = require('./jobs/sync-order-status');

// Configuração do job de sincronização
const orderSyncJob = new OrderStatusSyncJob();
const SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutos

// Executa job de sincronização periodicamente
setInterval(() => {
    orderSyncJob.run().catch(error => {
        console.error('[Server] Erro ao executar job de sincronização', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
    });
}, SYNC_INTERVAL);

// Executa primeira vez ao iniciar
orderSyncJob.run().catch(console.error);

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
