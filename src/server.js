const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('./store/redis-store');
const { 
    WhatsAppService,
    TrackingService,
    OrderValidationService,
    GroqServices,
    AudioService,
    ImageService,
    MediaManagerService,
    NuvemshopService,
    AIServices,
    WebhookService,
    WhatsAppImageService,
    OpenAIService,
    CacheService,
    BusinessHoursService
} = require('./services');

// Importação dos novos serviços
const { OpenAIVisionService } = require('./services/openai-vision-service');

// Configurações
const { 
    RATE_LIMIT_CONFIG,
    REDIS_CONFIG,
    PORT
} = require('./config/settings');

// Lista de variáveis de ambiente requeridas
const requiredEnvVars = [
    'PORT'
];

// Inicializa o Redis Store
const redisStore = new RedisStore();

// Configuração do rate limiter
const limiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.windowMs || 15 * 60 * 1000, // 15 minutos por padrão
    max: RATE_LIMIT_CONFIG.max || 100, // limite de 100 requisições por windowMs
    message: 'Muitas requisições deste IP, por favor tente novamente mais tarde.',
    standardHeaders: true,
    legacyHeaders: false,
});

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
            
            // Inicialização dos serviços
            const whatsAppService = new WhatsAppService();
            console.log('✅ WhatsAppService criado');

            const whatsAppImageService = new WhatsAppImageService();
            console.log('✅ WhatsAppImageService criado');

            const openAIService = new OpenAIService();
            console.log('✅ OpenAIService criado');

            const openAIVisionService = new OpenAIVisionService();
            console.log('✅ OpenAIVisionService criado');

            const trackingService = new TrackingService(whatsAppService);
            console.log('✅ TrackingService criado');

            const orderValidationService = new OrderValidationService(null, whatsAppService);
            console.log('✅ OrderValidationService criado');

            // Inicializa o WhatsApp e aguarda conexão
            await whatsAppService.init();
            console.log('✅ WhatsAppService inicializado');

            // Verifica se o cliente está conectado
            const client = await whatsAppService.getClient();
            if (!client) {
                throw new Error('WhatsAppService não inicializou corretamente');
            }

            // Inicializa outros serviços
            groqServices = new GroqServices();
            console.log('✅ GroqServices inicializado');

            audioService = new AudioService(groqServices, whatsAppService);
            console.log('✅ AudioService inicializado');

            // Inicializa os serviços de IA
            const aiServices = new AIServices(
                whatsAppService,
                whatsAppImageService,
                openAIVisionService,
                openAIService,
                audioService,
                trackingService,
                orderValidationService
            );
            console.log('✅ AIServices inicializado');

            imageService = new ImageService(whatsAppService);
            console.log('✅ ImageService inicializado');

            mediaManagerService = new MediaManagerService(audioService, imageService);
            console.log('✅ MediaManagerService inicializado');

            businessHoursService = new BusinessHoursService();
            console.log('✅ BusinessHoursService inicializado');

            nuvemshopService = new NuvemshopService(cacheService);
            console.log('✅ NuvemshopService inicializado');

            webhookService = new WebhookService(whatsAppService, aiServices, audioService);
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
app.use(cors());
app.use(limiter); // Aplica rate limiting
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Healthcheck endpoint para Railway
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        services: {
            redis: redisStore.isConnected(),
            whatsapp: whatsappService?.isConnected() || false
        },
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Rota de healthcheck
app.get('/healthcheck', (req, res) => {
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

// Handler para mensagens recebidas
app.post('/webhook/msg_recebidas', async (req, res) => {
    try {
        const message = req.body;
        
        console.log('📨 Mensagem recebida:', {
            tipo: message.message?.imageMessage ? 'imagem' : 'texto',
            de: message.key?.remoteJid
        });

        // Processa imagens
        if (message.message?.imageMessage) {
            const result = await aiServices.handleImageMessage(message);
            
            // Envia a resposta para o usuário
            if (result.response) {
                await whatsappService.sendText(
                    message.key.remoteJid,
                    result.response
                );
            }
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(500).json({
            error: 'Erro interno',
            message: error.message
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
