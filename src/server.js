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
let cacheService;

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

            // Inicializa Cache Service que depende do Redis
            cacheService = new CacheService();
            console.log('✅ CacheService inicializado');

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

            // OpenAI precisa de vários serviços
            openAIService = new OpenAIService(
                nuvemshopService,
                trackingService,
                businessHoursService,
                orderValidationService,
                null, // financialService será injetado depois
                null  // whatsappService será injetado depois para evitar dependência circular
            );
            console.log('✅ OpenAIService inicializado');

            // Serviços de mídia na ordem correta
            audioService = new AudioService(groqServices);
            console.log('✅ AudioService inicializado');

            imageService = new ImageService();
            console.log('✅ ImageService inicializado');

            // MediaManager precisa de Audio e Image
            mediaManagerService = new MediaManagerService(audioService, imageService);
            console.log('✅ MediaManagerService inicializado');

            // WhatsApp precisa do MediaManager
            whatsappService = new WhatsAppService(mediaManagerService);
            await whatsappService.initialize();  
            console.log('✅ WhatsAppService inicializado');

            // WhatsAppImage precisa do WhatsApp
            whatsappImageService = new WhatsAppImageService(whatsappService);
            console.log('✅ WhatsAppImageService inicializado');

            // AIServices precisa de vários serviços
            aiServices = new AIServices(
                whatsappService,
                whatsappImageService,
                openAIService,
                audioService
            );
            console.log('✅ AIServices inicializado');

            // Inicializa apenas os serviços que têm método initialize
            await Promise.all([
                whatsappService.initialize && whatsappService.initialize(),
                trackingService.initialize && trackingService.initialize(),
                orderValidationService.initialize && orderValidationService.initialize(),
                nuvemshopService.initialize && nuvemshopService.initialize(),
                groqServices.initialize && groqServices.initialize(),
                audioService.initialize && audioService.initialize(),
                imageService.initialize && imageService.initialize(),
                mediaManagerService.initialize && mediaManagerService.initialize(),
                aiServices.initialize && aiServices.initialize()
            ].filter(Boolean));

            // Inicializa serviços que dependem de outros
            webhookService = new WebhookService(whatsappService, aiServices);
            console.log('✅ WebhookService inicializado');

            // Atualiza referência do OpenAIService no WhatsAppService
            whatsappService.setOpenAIService(openAIService);
            
            // Atualiza referências circulares do OpenAIService
            openAIService.setWhatsAppService(whatsappService);
            openAIService.setFinancialService(financialService);
            
            console.log('✅ Dependências circulares resolvidas');

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

// Healthcheck endpoint para Railwayz
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

app.get('/health', async (req, res) => {
    if (isInitializing) {
        res.status(200).json({
            status: 'initializing',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
        return;
    }

    try {
        // Timeout de 5 segundos para healthcheck
        const timeout = setTimeout(() => {
            throw new Error('Timeout ao verificar serviços');
        }, 5000);

        // Verifica Redis
        let redisConnected = false;
        try {
            redisConnected = redisStore?.isConnected?.() || false;
            if (redisConnected) {
                redisConnected = await redisStore.ping();
            }
        } catch (error) {
            console.error('[Health] Erro ao verificar Redis:', error);
            redisConnected = false;
        }

        // Verifica WhatsApp
        let whatsappConnected = false;
        try {
            whatsappConnected = await whatsappService?.isConnected?.() || false;
        } catch (error) {
            console.error('[Health] Erro ao verificar WhatsApp:', error);
            whatsappConnected = false;
        }

        // Atualiza status geral
        const allServicesConnected = redisConnected && whatsappConnected;
        servicesReady = allServicesConnected;

        clearTimeout(timeout);

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
    } catch (error) {
        console.error('[Health] Erro ao verificar serviços:', error);
        res.status(503).json({
            status: 'error',
            services: {
                redis: false,
                whatsapp: false
            },
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            error: error.message
        });
    }
});

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

// Rota de teste para simular mensagens
app.post('/test/message', async (req, res) => {
    try {
        const { phoneNumber, text, type = 'text', mediaUrl } = req.body;

        if (!phoneNumber || !text) {
            return res.status(400).json({
                status: 'error',
                message: 'phoneNumber e text são obrigatórios'
            });
        }

        // Simula o formato de mensagem do WhatsApp
        const mockMessage = {
            from: phoneNumber,
            type,
            text,
            media: mediaUrl ? { url: mediaUrl } : undefined
        };

        // Processa a mensagem
        if (!webhookService) {
            throw new Error('WebhookService não inicializado');
        }

        await webhookService.handleWhatsAppMessage(mockMessage);
        res.status(200).json({ status: 'success', message: 'Mensagem processada' });
    } catch (error) {
        console.error('❌ Erro ao processar mensagem de teste:', error);
        res.status(500).json({
            status: 'error',
            message: 'Erro ao processar mensagem',
            error: error.message
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
