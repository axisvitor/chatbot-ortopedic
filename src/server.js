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
    BusinessHoursService,
    OpenAIVisionService,
    FinancialService,
    DepartmentService
} = require('./services');
const cron = require('node-cron');

// Configurações
const { 
    RATE_LIMIT_CONFIG,
    PORT
} = require('./config/settings');

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

console.log('🚀 Iniciando servidor...');

// Inicializa o app
const app = express();
app.set('trust proxy', req => {
    return req.path === '/health';
});
const port = process.env.PORT || PORT;

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
            if (!process.env.PORT) {
                throw new Error('Variável de ambiente PORT não definida');
            }

            // Inicializa serviços base primeiro
            redisStore = new RedisStore();
            await redisStore.connect();
            console.log('✅ RedisStore conectado');

            // Serviços independentes
            businessHoursService = new BusinessHoursService();
            console.log('✅ BusinessHoursService inicializado');

            nuvemshopService = new NuvemshopService();
            console.log('✅ NuvemshopService inicializado');

            groqServices = new GroqServices();
            console.log('✅ GroqServices inicializado');

            imageService = new ImageService();
            console.log('✅ ImageService inicializado');

            // MediaManager precisa do Image
            mediaManagerService = new MediaManagerService(null, imageService);
            console.log('✅ MediaManagerService inicializado');

            // WhatsApp precisa do MediaManager
            whatsappService = new WhatsAppService(mediaManagerService);
            await whatsappService.initialize();  
            console.log('✅ WhatsAppService inicializado');

            // WhatsAppImage precisa do WhatsApp
            whatsappImageService = new WhatsAppImageService(whatsappService);
            console.log('✅ WhatsAppImageService inicializado');

            // Audio precisa do WhatsApp e Groq
            audioService = new AudioService(groqServices, whatsappService);
            console.log('✅ AudioService inicializado');

            // Atualiza MediaManager com AudioService
            mediaManagerService.setAudioService(audioService);
            console.log('✅ MediaManager atualizado com AudioService');

            // Reinicializa serviços com dependência do WhatsApp
            trackingService = new TrackingService(whatsappService);
            console.log('✅ TrackingService reinicializado com WhatsApp');

            orderValidationService = new OrderValidationService(nuvemshopService, whatsappService);
            console.log('✅ OrderValidationService reinicializado com dependências');

            financialService = new FinancialService(whatsappService);
            console.log('✅ FinancialService reinicializado com WhatsApp');

            departmentService = new DepartmentService(whatsappService);
            console.log('✅ DepartmentService inicializado com WhatsApp');

            // OpenAI precisa de vários serviços
            openAIService = new OpenAIService(
                nuvemshopService,
                trackingService,
                businessHoursService,
                orderValidationService,
                financialService,
                departmentService,
                whatsappService
            );
            console.log('✅ OpenAIService inicializado');

            // Configura OpenAI no WhatsApp
            whatsappService.setOpenAIService(openAIService);
            console.log('✅ WhatsApp configurado com OpenAI');

            // OpenAI Vision é independente
            openAIVisionService = new OpenAIVisionService();
            console.log('✅ OpenAIVisionService inicializado');

            // AIServices precisa de todos os serviços anteriores
            aiServices = new AIServices(
                whatsappService,
                whatsappImageService,
                openAIService,
                openAIVisionService,
                audioService
            );
            console.log('✅ AIServices inicializado');

            // Webhook precisa do WhatsApp e AI
            webhookService = new WebhookService(whatsappService, aiServices);
            console.log('✅ WebhookService inicializado');

            clearTimeout(timeout);
            servicesReady = true;
            isInitializing = false;
            console.log('✅ Todos os serviços inicializados com sucesso');
            resolve();

        } catch (error) {
            clearTimeout(timeout);
            isInitializing = false;
            lastError = error;
            console.error('❌ Erro ao inicializar serviços:', error);
            reject(error);
        }
    });
}

// Função para inicializar tarefas agendadas
function initializeScheduledTasks() {
    // Sincroniza pedidos da Nuvemshop a cada 30 minutos
    cron.schedule('*/30 * * * *', async () => {
        try {
            console.log('🔄 Iniciando sincronização de pedidos...');
            await nuvemshopService.syncOrders();
        } catch (error) {
            console.error('❌ Erro ao sincronizar pedidos:', error);
        }
    });

    // Atualiza status de rastreamento a cada 2 horas
    cron.schedule('0 */2 * * *', async () => {
        try {
            console.log('🔄 Atualizando status de rastreamento...');
            await trackingService.updateAllTrackingStatus();
        } catch (error) {
            console.error('❌ Erro ao atualizar status de rastreamento:', error);
        }
    });

    // Limpa cache antigo todo dia à meia-noite
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log('🧹 Iniciando limpeza de cache...');
            await redisStore.cleanOldCache();
        } catch (error) {
            console.error('❌ Erro ao limpar cache:', error);
        }
    });

    // Verifica pedidos pendentes a cada hora
    cron.schedule('0 * * * *', async () => {
        try {
            console.log('🔍 Verificando pedidos pendentes...');
            await orderValidationService.checkPendingOrders();
        } catch (error) {
            console.error('❌ Erro ao verificar pedidos pendentes:', error);
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

// Handler para mensagens recebidas
app.post('/webhook/msg_recebidas_ou_enviadas', async (req, res) => {
    try {
        const message = req.body;
        
        console.log('📨 Mensagem recebida:', {
            tipo: message.message?.imageMessage ? 'imagem' : 'texto',
            de: message.key?.remoteJid,
            texto: message.message?.conversation || message.message?.extendedTextMessage?.text
        });

        // Extrai o remetente
        const from = message.key?.remoteJid?.replace('@s.whatsapp.net', '');
        if (!from) {
            throw new Error('Remetente não encontrado na mensagem');
        }

        // Processa imagens
        if (message.message?.imageMessage) {
            const result = await aiServices.handleImageMessage(message);
            
            // Envia a resposta do processamento da imagem
            if (result.response) {
                await whatsappService.sendText(
                    message.key.remoteJid,
                    result.response
                );
            }
        } 
        // Processa mensagens de texto
        else if (message.message?.conversation || message.message?.extendedTextMessage?.text) {
            const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
            
            // Processa a mensagem com o OpenAI Assistant
            const response = await openAIService.runAssistant(from, text);
            
            // Envia a resposta do Assistant
            if (response) {
                await whatsappService.sendText(from, response);
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
    let server;
    
    while (retries < maxRetries) {
        try {
            await initializeServices();
            servicesReady = true;
            isInitializing = false;
            lastError = null;
            
            // Inicializa tarefas agendadas
            initializeScheduledTasks();
            
            server = app.listen(PORT, () => {
                console.log(`🚀 Servidor rodando na porta ${PORT}`);
                console.log('✅ Todos os serviços inicializados com sucesso');
            });

            // Graceful shutdown para ambiente 24/7
            const shutdown = async (signal) => {
                console.log(`\n🔄 Recebido ${signal}. Iniciando transição graceful...`);
                
                try {
                    // 1. Notifica o health check que estamos em modo de transição
                    servicesReady = false;
                    isInitializing = true;
                    
                    // 2. Salva estado atual das conversas
                    if (whatsappService?.saveState) {
                        console.log('💾 Salvando estado das conversas...');
                        await whatsappService.saveState();
                    }

                    // 3. Processa mensagens na fila
                    if (redisStore?.processRemainingQueue) {
                        console.log('📨 Processando mensagens restantes na fila...');
                        await redisStore.processRemainingQueue();
                    }

                    // 4. Fecha conexões mantendo funcionalidade
                    console.log('🔌 Preparando serviços para transição...');
                    
                    // Redis - mantém conexão para fila
                    if (redisStore?.prepareForTransition) {
                        await redisStore.prepareForTransition();
                    }

                    // WhatsApp - salva sessão mas mantém conexão
                    if (whatsappService?.prepareForTransition) {
                        await whatsappService.prepareForTransition();
                    }

                    console.log('✅ Serviços prontos para transição');
                    console.log('👋 Encerrando processo para atualização');
                    process.exit(0);
                } catch (error) {
                    console.error('❌ Erro durante transição:', error);
                    // Em caso de erro, tentamos manter o serviço rodando
                    servicesReady = true;
                    isInitializing = false;
                    console.error('⚠️ Continuando operação normal');
                }
            };

            // Registra handlers para sinais de término
            process.on('SIGTERM', () => shutdown('SIGTERM'));
            process.on('SIGINT', () => shutdown('SIGINT'));
            
            return app;
        } catch (error) {
            retries++;
            lastError = error;
            console.error(`❌ Tentativa ${retries}/${maxRetries} falhou:`, error);
            
            if (retries === maxRetries) {
                isInitializing = false;
                servicesReady = false;
                console.error('❌ Número máximo de tentativas atingido.');
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
