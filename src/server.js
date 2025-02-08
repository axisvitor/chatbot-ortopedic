const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('./store/redis-store');
const { 
    WhatsAppService,
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
    BusinessHoursService,
    OpenAIVisionService,
    FinancialService,
    DepartmentService,
    CacheService
} = require('./services');
const { TrackingServiceSync } = require('./tracking-system/services/tracking-service-sync');
const cron = require('node-cron');
const logger = console;

// Configurações
const { 
    RATE_LIMIT_CONFIG,
} = require('./config/settings');

// Declaração dos serviços
let redisStore;
let cacheService;
let groqServices;
let webhookService;
let whatsappService;
let aiServices;
let audioService;
let imageService;
let mediaManagerService;
let businessHoursService;
let trackingServiceSync;
let orderValidationService;
let nuvemshopService;
let openAIService;
let financialService;
let openAIVisionService;
let departmentService;

// Configuração do rate limiter
const limiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG?.windowMs || 15 * 60 * 1000, // 15 minutos
    max: RATE_LIMIT_CONFIG?.max || 100,
    message: RATE_LIMIT_CONFIG?.message || 'Muitas requisições deste IP, por favor tente novamente mais tarde.',
    standardHeaders: RATE_LIMIT_CONFIG?.standardHeaders || true,
    legacyHeaders: RATE_LIMIT_CONFIG?.legacyHeaders || false,
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    logger.error('❌ Erro não capturado:', {
        erro: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
    });
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('❌ Promise rejeitada não tratada:', {
        razao: reason,
        timestamp: new Date().toISOString()
    });
});

logger.info('🚀 Iniciando servidor...');

// Inicializa o app
const app = express();
app.set('trust proxy', req => {
    return req.path === '/health';
});
const port = process.env.PORT;

logger.info(`📝 Porta configurada: ${port}`);

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
            logger.info('🔄 Iniciando serviços...');
            
            // Verifica variáveis de ambiente
            if (!process.env.PORT) {
                throw new Error('Variável de ambiente PORT não definida');
            }

            // Inicializa serviços base primeiro
            redisStore = new RedisStore();
            try {
                await redisStore.connect();
                logger.info('[Server] RedisStore conectado', {
                    timestamp: new Date().toISOString()
                });

                // Verifica se o Redis está realmente conectado
                if (!redisStore.isConnected()) {
                    throw new Error('Redis não está conectado após inicialização');
                }
            } catch (error) {
                logger.error('[Server] Erro ao conectar ao Redis:', {
                    erro: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });
                throw error;
            }

            try {
                // Inicializa CacheService com o mesmo RedisStore
                cacheService = new CacheService();
                cacheService.redisStore = redisStore; // Usa o mesmo RedisStore já conectado
                logger.info('[Server] CacheService inicializado', {
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                logger.error('[Server] Erro ao inicializar CacheService:', error);
                throw error;
            }

            // Serviços independentes
            businessHoursService = new BusinessHoursService();
            logger.info('[Server] BusinessHoursService inicializado', {
                timestamp: new Date().toISOString()
            });

            // Serviços que dependem do cache
            nuvemshopService = new NuvemshopService(redisStore); // Passando redisStore diretamente
            logger.info('[Server] NuvemshopService inicializado com RedisStore', {
                timestamp: new Date().toISOString()
            });

            // Tracking usa seu próprio RedisStoreSync
            trackingServiceSync = new TrackingServiceSync();
            logger.info('[Server] TrackingServiceSync inicializado', {
                timestamp: new Date().toISOString()
            });

            // Outros serviços independentes
            groqServices = new GroqServices();
            logger.info('[Server] GroqServices inicializado', {
                timestamp: new Date().toISOString()
            });

            imageService = new ImageService();
            logger.info('[Server] ImageService inicializado', {
                timestamp: new Date().toISOString()
            });

            // MediaManager precisa do Image
            mediaManagerService = new MediaManagerService(null, imageService);
            logger.info('[Server] MediaManagerService inicializado', {
                timestamp: new Date().toISOString()
            });

            // WhatsApp precisa do MediaManager
            whatsappService = new WhatsAppService(mediaManagerService);
            await whatsappService.initialize();  
            logger.info('[Server] WhatsAppService inicializado', {
                timestamp: new Date().toISOString()
            });

            // WhatsAppImage precisa do WhatsApp
            whatsappImageService = new WhatsAppImageService(whatsappService);
            logger.info('[Server] WhatsAppImageService inicializado', {
                timestamp: new Date().toISOString()
            });

            // Audio precisa do WhatsApp e Groq
            audioService = new AudioService(groqServices, whatsappService);
            logger.info('[Server] AudioService inicializado', {
                timestamp: new Date().toISOString()
            });

            // Atualiza MediaManager com AudioService
            mediaManagerService.setAudioService(audioService);
            logger.info('[Server] MediaManager atualizado com AudioService', {
                timestamp: new Date().toISOString()
            });

            // Reinicializa serviços com dependência do WhatsApp
            orderValidationService = new OrderValidationService(nuvemshopService, whatsappService);
            await orderValidationService.initialize();
            logger.info('[Server] OrderValidationService reinicializado com dependências', {
                timestamp: new Date().toISOString()
            });

            financialService = new FinancialService(whatsappService);
            logger.info('[Server] FinancialService reinicializado com WhatsApp', {
                timestamp: new Date().toISOString()
            });

            departmentService = new DepartmentService(whatsappService);
            logger.info('[Server] DepartmentService inicializado com WhatsApp', {
                timestamp: new Date().toISOString()
            });

            // OpenAI precisa de vários serviços
            openAIService = new OpenAIService(
                nuvemshopService,
                trackingServiceSync,
                businessHoursService,
                orderValidationService,
                financialService,
                departmentService,
                whatsappService
            );
            logger.info('[Server] OpenAIService inicializado', {
                timestamp: new Date().toISOString()
            });

            // Configura OpenAI no WhatsApp
            whatsappService.setOpenAIService(openAIService);
            logger.info('[Server] WhatsApp configurado com OpenAI', {
                timestamp: new Date().toISOString()
            });

            // OpenAI Vision é independente
            openAIVisionService = new OpenAIVisionService();
            logger.info('[Server] OpenAIVisionService inicializado', {
                timestamp: new Date().toISOString()
            });

            // AIServices precisa de todos os serviços anteriores
            aiServices = new AIServices(
                whatsappService,
                whatsappImageService,
                openAIService,
                openAIVisionService,
                audioService
            );
            logger.info('[Server] AIServices inicializado', {
                timestamp: new Date().toISOString()
            });

            // Webhook precisa do WhatsApp, AI e outros serviços
            webhookService = new WebhookService(
                whatsappService,
                aiServices,
                audioService,
                mediaManagerService
            );
            logger.info('[Server] WebhookService inicializado', {
                timestamp: new Date().toISOString()
            });

            clearTimeout(timeout);
            servicesReady = true;
            isInitializing = false;
            logger.info('[Server] ✅ Todos os serviços inicializados com sucesso', {
                timestamp: new Date().toISOString()
            });
            resolve();

        } catch (error) {
            clearTimeout(timeout);
            isInitializing = false;
            lastError = error;
            logger.error('[Server] ❌ Erro ao inicializar serviços:', error);
            reject(error);
        }
    });
}

// Função para inicializar tarefas agendadas
function initializeScheduledTasks() {
    // Sincroniza pedidos da Nuvemshop a cada 30 minutos
    cron.schedule('*/30 * * * *', async () => {
        try {
            logger.info('[Server] 🔄 Iniciando sincronização de pedidos...');
            await nuvemshopService.orderService.syncOrders();
        } catch (error) {
            logger.error('[Server] ❌ Erro ao sincronizar pedidos:', error);
        }
    });

    // Atualiza status de rastreamento a cada 2 horas
    cron.schedule('0 */2 * * *', async () => {
        try {
            logger.info('[Server] 🔄 Atualizando status de rastreamento...');
            await trackingServiceSync.updateAllTrackingStatus();
        } catch (error) {
            logger.error('[Server] ❌ Erro ao atualizar status de rastreamento:', error);
        }
    });

    // Limpa cache antigo todo dia à meia-noite
    cron.schedule('0 0 * * *', async () => {
        try {
            logger.info('[Server] 🧹 Iniciando limpeza de cache...');
            await redisStore.cleanOldCache();
        } catch (error) {
            logger.error('[Server] ❌ Erro ao limpar cache:', error);
        }
    });

    // Verifica pedidos pendentes a cada hora
    cron.schedule('0 * * * *', async () => {
        try {
            logger.info('[Server] 🔍 Verificando pedidos pendentes...');
            await orderValidationService.checkPendingOrders();
        } catch (error) {
            logger.error('[Server] ❌ Erro ao verificar pedidos pendentes:', error);
        }
    });
}

// Middlewares
app.use(cors());
app.use(limiter); // Aplica rate limiting
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health Check
app.get('/health', (_req, res) => {
    if (!servicesReady) {
        if (isInitializing) {
            return res.status(503).json({
                status: 'initializing',
                message: 'Serviços ainda estão inicializando',
                error: lastError?.message
            });
        }
        return res.status(503).json({
            status: 'error',
            message: 'Serviços não inicializados corretamente',
            error: lastError?.message
        });
    }

    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

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

// Rota para receber mensagens do WhatsApp (W-API)
app.post('/webhook/msg_recebidas_ou_enviadas', async (req, res) => {
    try {
        logger.info('[Server] 📥 [Server] Webhook recebido:', {
            tipo: req.body?.type,
            temBody: !!req.body?.body,
            temMensagem: !!req.body?.body?.message || !!req.body?.message,
            remetente: req.body?.body?.key?.remoteJid || req.body?.key?.remoteJid,
            pushName: req.body?.body?.pushName || req.body?.pushName,
            timestamp: new Date().toISOString()
        });

        if (!webhookService) {
            throw new Error('WebhookService não inicializado');
        }

        await webhookService.handleWebhook(req.body);
        res.status(200).json({ status: 'success' });
    } catch (error) {
        logger.error('[Server] ❌ [Server] Erro no webhook:', {
            erro: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
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
        logger.error('[Server] ❌ Erro ao enviar mensagem:', error);
        res.status(500).json({
            status: 'error',
            message: 'Erro ao enviar mensagem',
            error: error.message
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
        logger.error('[Server] ❌ Erro ao processar mensagem de teste:', error);
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
    let server;
    
    while (retries < maxRetries) {
        try {
            await initializeServices();
            servicesReady = true;
            isInitializing = false;
            lastError = null;
            
            // Inicializa tarefas agendadas
            initializeScheduledTasks();
            
            app.listen(port, () => {
                logger.info(`🚀 Servidor rodando na porta ${port}`);
                logger.info('[Server] ✅ Todos os serviços inicializados com sucesso');
            });

            // Graceful shutdown para ambiente 24/7
            const shutdown = async (signal) => {
                logger.info(`[Server] 🔄 Recebido ${signal}. Iniciando transição graceful...`);
                
                try {
                    // 1. Notifica o health check que estamos em modo de transição
                    servicesReady = false;
                    isInitializing = true;
                    
                    // 2. Salva estado atual das conversas
                    if (whatsappService?.saveState) {
                        logger.info('[Server] 💾 Salvando estado das conversas...');
                        await whatsappService.saveState();
                    }

                    // 3. Processa mensagens na fila
                    if (redisStore?.processRemainingQueue) {
                        logger.info('[Server] 📨 Processando mensagens restantes na fila...');
                        await redisStore.processRemainingQueue();
                    }

                    // 4. Fecha conexões mantendo funcionalidade
                    logger.info('[Server] 🔌 Preparando serviços para transição...');
                    
                    // Redis - mantém conexão para fila
                    if (redisStore?.prepareForTransition) {
                        await redisStore.prepareForTransition();
                    }

                    // WhatsApp - salva sessão mas mantém conexão
                    if (whatsappService?.prepareForTransition) {
                        await whatsappService.prepareForTransition();
                    }

                    logger.info('[Server] ✅ Serviços prontos para transição');
                    logger.info('[Server] 👋 Encerrando processo para atualização');
                    process.exit(0);
                } catch (error) {
                    logger.error('[Server] ❌ Erro durante transição:', error);
                    // Em caso de erro, tentamos manter o serviço rodando
                    servicesReady = true;
                    isInitializing = false;
                    logger.error('[Server] ⚠️ Continuando operação normal');
                }
            };

            // Registra handlers para sinais de término
            process.on('SIGTERM', () => shutdown('SIGTERM'));
            process.on('SIGINT', () => shutdown('SIGINT'));
            
            return app;
        } catch (error) {
            retries++;
            lastError = error;
            logger.error(`[Server] ❌ Tentativa ${retries}/${maxRetries} falhou:`, error);
            
            if (retries === maxRetries) {
                isInitializing = false;
                servicesReady = false;
                logger.error('[Server] ❌ Número máximo de tentativas atingido.');
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
        logger.error('[Server] ❌ Erro fatal ao iniciar servidor:', error);
        process.exit(1);
    });
}
