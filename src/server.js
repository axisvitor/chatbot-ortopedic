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
let requiredEnvVars = [
    'PORT'
];

// Declaração dos serviços
let redisStore;
let groqServices;
let webhookService;
let whatsappService;
let aiServices;
let audioService;
let imageService;
let mediaManagerService;
let businessHoursService;
let trackingService;
let orderValidationService;
let nuvemshopService;
let openAIService;
let financialService;

// Configuração do rate limiter
const limiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.windowMs || 15 * 60 * 1000,
    max: RATE_LIMIT_CONFIG.max || 100,
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
        if (redisStore) await redisStore.disconnect();
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
    return req.path === '/health';
});
const port = process.env.PORT || 8080;

console.log(`📝 Porta configurada: ${port}`);

// Variáveis globais de estado
let isInitializing = true;
let servicesReady = false;
let lastError = null;

// Função de inicialização
async function initializeServices() {
    return new Promise(async (resolve, reject) => {
        // Timeout de 30 segundos para inicialização
        const timeout = setTimeout(() => {
            reject(new Error('Timeout ao inicializar serviços'));
        }, 30000);

        try {
            console.log('🔄 Iniciando serviços...');
            
            // Verifica variáveis de ambiente
            for (const envVar of requiredEnvVars) {
                if (!process.env[envVar]) {
                    throw new Error(`Variável de ambiente ${envVar} não definida`);
                }
            }

            // Inicializa serviços base primeiro
            redisStore = new RedisStore();
            await redisStore.connect();
            console.log('✅ RedisStore conectado');

            // Serviços independentes
            businessHoursService = new BusinessHoursService();
            console.log('✅ BusinessHoursService inicializado');

            trackingService = new TrackingService();
            console.log('✅ TrackingService inicializado');

            orderValidationService = new OrderValidationService();
            console.log('✅ OrderValidationService inicializado');

            nuvemshopService = new NuvemshopService();
            console.log('✅ NuvemshopService inicializado');

            groqServices = new GroqServices();
            console.log('✅ GroqServices inicializado');

            audioService = new AudioService();
            console.log('✅ AudioService inicializado');

            imageService = new ImageService();
            console.log('✅ ImageService inicializado');

            mediaManagerService = new MediaManagerService();
            console.log('✅ MediaManagerService inicializado');

            // Inicializa serviços com dependências
            whatsappService = new WhatsAppService(orderValidationService);
            console.log('✅ WhatsAppService inicializado');

            openAIService = new OpenAIService(
                nuvemshopService,
                trackingService,
                businessHoursService,
                orderValidationService,
                null,
                whatsappService // Injeta WhatsAppService
            );
            console.log('✅ OpenAIService inicializado');

            // Atualiza referência do OpenAIService no WhatsAppService
            whatsappService.setOpenAIService(openAIService);
            console.log('✅ Dependências circulares resolvidas');

            // Inicializa serviços que dependem de outros
            aiServices = new AIServices(openAIService);
            console.log('✅ AIServices inicializado');

            webhookService = new WebhookService(whatsappService, aiServices);
            console.log('✅ WebhookService inicializado');

            clearTimeout(timeout);
            resolve();
        } catch (error) {
            clearTimeout(timeout);
            console.error('❌ Erro ao inicializar serviços:', error);
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
    if (isInitializing) {
        res.status(200).json({
            status: 'initializing',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
        return;
    }

    res.status(servicesReady ? 200 : 503).json({
        status: servicesReady ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        error: lastError?.message
    });
});

app.get('/health', (req, res) => {
    // Durante inicialização, retorna 200 para dar tempo aos serviços
    if (isInitializing) {
        res.status(200).json({
            status: 'initializing',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
        return;
    }

    // Verifica estado dos serviços
    const redisConnected = redisStore?.isConnected?.() || false;
    const whatsappConnected = whatsappService?.isConnected?.() || false;

    const allServicesConnected = redisConnected && whatsappConnected;
    servicesReady = allServicesConnected;

    res.status(allServicesConnected ? 200 : 503).json({
        status: allServicesConnected ? 'ok' : 'error',
        services: {
            redis: redisConnected,
            whatsapp: whatsappConnected
        },
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        error: lastError?.message
    });
});

// Rota de healthcheck
app.get('/healthcheck', (req, res) => {
    const status = servicesReady ? 'ok' : 'initializing';
    const error = lastError?.message;
    
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
    isInitializing = true;
    
    while (retries < maxRetries) {
        try {
            await initializeServices();
            servicesReady = true;
            isInitializing = false;
            lastError = null;
            
            const server = app.listen(port, () => {
                console.log(`🚀 Servidor rodando na porta ${port}`);
                console.log('✅ Todos os serviços inicializados com sucesso');
            });

            // Graceful shutdown
            process.on('SIGTERM', () => {
                console.log('Recebido SIGTERM. Iniciando shutdown graceful...');
                server.close(() => {
                    console.log('Servidor HTTP fechado.');
                    process.exit(0);
                });
            });
            
            return server;
        } catch (error) {
            retries++;
            lastError = error;
            console.error(`❌ Tentativa ${retries}/${maxRetries} falhou:`, error);
            
            if (retries === maxRetries) {
                isInitializing = false;
                servicesReady = false;
                console.error('❌ Número máximo de tentativas atingido.');
                // Não encerra o processo, deixa o healthcheck reportar o erro
                return null;
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
