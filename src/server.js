const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('redis');

// Lista de variáveis de ambiente requeridas
const requiredEnvVars = [
    'WAPI_URL',
    'WAPI_TOKEN',
    'WAPI_CONNECTION_KEY',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD'
];

// Configuração do cliente Redis
const redisClient = createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    },
    password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => {
    console.error('❌ Erro no Redis:', {
        erro: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
    });
});

redisClient.on('connect', () => {
    console.log('✅ Redis conectado com sucesso');
});

redisClient.on('reconnecting', () => {
    console.log('🔄 Redis reconectando...');
});

// Conecta ao Redis
(async () => {
    try {
        await redisClient.connect();
    } catch (error) {
        console.error('❌ Erro ao conectar ao Redis:', error);
    }
})();

const redisStore = {
    get: async (key) => {
        try {
            return await redisClient.get(key);
        } catch (error) {
            console.error('❌ Erro ao obter valor do Redis:', {
                key,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    },
    set: async (key, value, ttl) => {
        try {
            const result = await redisClient.set(key, value, {
                EX: ttl
            });
            return result;
        } catch (error) {
            console.error('❌ Erro ao definir valor no Redis:', {
                key,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }
};

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
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro ao encerrar servidor:', error);
        process.exit(1);
    }
});

console.log('🚀 Iniciando servidor...');

// Serviços
const { GroqServices } = require('./services/groq-services');
const { WebhookService } = require('./services/webhook-service');
const { WhatsAppService } = require('./services/whatsapp-service');
const { AIServices } = require('./services/ai-services');
const AudioService = require('./services/audio-service');
const ImageService = require('./services/image-service');
const businessHours = require('./services/business-hours');

console.log('✅ Módulos carregados');

// Configurações
const { RATE_LIMIT_CONFIG } = require('./config/settings');

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
            
            // Inicializa o WhatsAppService primeiro
            whatsappService = new WhatsAppService();
            await whatsappService.init();
            const client = await whatsappService.getClient();
            if (!client) {
                throw new Error('WhatsAppService não inicializou corretamente');
            }
            console.log('✅ WhatsAppService inicializado');

            // Inicializa os outros serviços
            groqServices = new GroqServices();
            console.log('✅ GroqServices inicializado');
            
            webhookService = new WebhookService();
            console.log('✅ WebhookService inicializado');
            
            audioService = new AudioService(groqServices, client);
            console.log('✅ AudioService inicializado');
            
            imageService = new ImageService(groqServices, client);
            console.log('✅ ImageService inicializado');
            
            // Inicializa o AIServices passando a instância do WhatsAppService
            aiServices = new AIServices(
                whatsappService, 
                null, // whatsAppImageService
                null, // redisStore
                null, // openAIService
                null, // trackingService
                null, // orderValidationService
                null  // nuvemshopService
            );
            console.log('✅ AIServices inicializado');
            
            console.log('✅ Todos os serviços inicializados com sucesso');
            isReady = true;
            clearTimeout(timeout);
            resolve();
        } catch (error) {
            console.error('❌ Erro ao inicializar serviços:', error);
            initError = error;
            clearTimeout(timeout);
            reject(error);
        }
    });
}

// Middlewares
app.use(helmet());
app.use(morgan('dev'));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Rate limiting
const limiter = rateLimit(RATE_LIMIT_CONFIG);
app.use(limiter);

// Healthcheck mais detalhado
app.get('/', (req, res) => {
    try {
        const status = {
            status: isReady ? 'ok' : 'initializing',
            timestamp: new Date().toISOString(),
            services: {
                whatsapp: whatsappService ? 'initialized' : 'pending',
                groq: groqServices ? 'initialized' : 'pending',
                webhook: webhookService ? 'initialized' : 'pending',
                ai: aiServices ? 'initialized' : 'pending',
                audio: audioService ? 'initialized' : 'pending',
                image: imageService ? 'initialized' : 'pending'
            },
            error: initError ? {
                message: initError.message,
                stack: initError.stack
            } : null
        };

        if (isReady) {
            res.json(status);
        } else {
            res.status(503).json(status);
        }
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Webhook para receber mensagens do WhatsApp
app.post('/webhook/msg_recebidas_ou_enviadas', async (req, res) => {
    try {
        console.log('📥 Webhook recebido:', {
            headers: req.headers,
            timestamp: new Date().toISOString()
        });

        console.log('🔍 Estrutura completa do webhook:', {
            event: req.body?.event,
            messageId: req.body?.messageId,
            body: req.body?.body,
            raw: JSON.stringify(req.body, null, 2)
        });

        const webhookData = req.body;

        // Verifica se é uma mensagem válida
        if (!webhookData || !webhookData.body) {
            console.log('⚠️ Webhook sem body:', webhookData);
            return res.sendStatus(200);
        }

        // Extrai a mensagem usando o WebhookService
        console.log('🔄 Tentando extrair mensagem do webhook...');
        const message = webhookService.extractMessageFromWebhook(webhookData);
        
        if (!message) {
            console.log('⚠️ Não foi possível extrair a mensagem do webhook');
            return res.sendStatus(200);
        }

        // Verifica se a mensagem já foi processada
        try {
            const messageKey = `processed_msg:${message.messageId}`;
            const isProcessed = await redisStore.get(messageKey);
            
            if (isProcessed) {
                console.log('⚠️ Mensagem já processada:', {
                    messageId: message.messageId,
                    timestamp: new Date().toISOString()
                });
                return res.sendStatus(200);
            }

            // Marca a mensagem como processada com TTL de 1 hora
            await redisStore.set(messageKey, 'true', 3600);
        } catch (error) {
            console.error('⚠️ Erro ao verificar duplicidade da mensagem:', {
                messageId: message.messageId,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            // Continua o processamento mesmo com erro no Redis
        }

        console.log('📝 Mensagem extraída com sucesso:', {
            tipo: message.type,
            de: message.from,
            texto: message.text?.substring(0, 100),
            temAudio: !!message.audioMessage,
            temImagem: !!message.imageMessage,
            messageId: message.messageId,
            timestamp: new Date().toISOString()
        });

        // Processa a mensagem
        console.log('🤖 Iniciando processamento da mensagem...');
        const response = await aiServices.handleMessage(message);

        if (response) {
            console.log('📤 Resposta gerada com sucesso:', {
                para: message.from,
                resposta: typeof response === 'string' ? response.substring(0, 100) : 'Objeto de resposta',
                timestamp: new Date().toISOString()
            });

            // Envia a resposta
            console.log('📨 Tentando enviar resposta via WhatsApp...', {
                para: message.from,
                resposta: typeof response === 'string' ? response.substring(0, 100) : JSON.stringify(response).substring(0, 100)
            });

            const responseText = typeof response === 'string' ? response : JSON.stringify(response);
            const sendResult = await whatsappService.sendText(message.from, responseText);
            console.log('✅ Resposta enviada:', {
                resultado: sendResult,
                timestamp: new Date().toISOString()
            });
        } else {
            console.log('⚠️ Nenhuma resposta gerada');
        }

    } catch (error) {
        console.error('❌ Erro no webhook:', {
            erro: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }

    res.sendStatus(200);
});

// Função para iniciar o servidor
async function startServer(maxRetries = 3) {
    let retryCount = 0;

    async function attemptStart() {
        try {
            console.log(`🚀 Tentativa ${retryCount + 1} de ${maxRetries} de iniciar o servidor...`);
            
            // Aguarda a inicialização dos serviços
            await initializeServices();
            
            // Inicia o servidor HTTP apenas se os serviços foram inicializados com sucesso
            if (isReady) {
                app.listen(port, () => {
                    console.log(`🚀 Servidor rodando na porta ${port}`);
                });
                return true;
            } else {
                throw new Error('Serviços não foram inicializados corretamente');
            }
        } catch (error) {
            console.error('❌ Erro ao iniciar servidor:', {
                tentativa: retryCount + 1,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            retryCount++;
            
            if (retryCount < maxRetries) {
                console.log(`⏳ Aguardando 5 segundos antes da próxima tentativa...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                return attemptStart();
            } else {
                console.error('❌ Número máximo de tentativas excedido');
                process.exit(1);
            }
        }
    }

    return attemptStart();
}

// Exporta para uso em testes
module.exports = { app, startServer };

// Se executado diretamente, inicia o servidor
if (require.main === module) {
    startServer();
}
