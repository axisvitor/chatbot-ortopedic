const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const bodyParser = require('body-parser');

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
    try {
        console.log('🔄 Iniciando serviços...');
        
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
        
        // Inicializa o AIServices por último
        aiServices = new AIServices(whatsappService);
        console.log('✅ AIServices inicializado');
        
        console.log('✅ Todos os serviços inicializados com sucesso');
        isReady = true;
    } catch (error) {
        console.error('❌ Erro ao inicializar serviços:', error);
        initError = error;
        throw error;
    }
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

// Healthcheck
app.get('/', (req, res) => {
    if (isReady) {
        res.json({ status: 'ok' });
    } else {
        res.status(503).json({ status: 'error', message: 'Serviço não está pronto', error: initError });
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
            console.log('📨 Tentando enviar resposta via WhatsApp...');
            const sendResult = await whatsappService.sendText(message.from, response);
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
async function startServer() {
    try {
        console.log('🚀 Iniciando servidor...');
        
        // Aguarda a inicialização dos serviços
        await initializeServices();
        
        // Inicia o servidor HTTP apenas se os serviços foram inicializados com sucesso
        if (isReady) {
            app.listen(port, () => {
                console.log(`🚀 Servidor rodando na porta ${port}`);
            });
        } else {
            throw new Error('Serviços não foram inicializados corretamente');
        }
    } catch (error) {
        console.error('❌ Erro fatal ao iniciar servidor:', {
            erro: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        
        // Aguarda 5 segundos antes de tentar reiniciar
        await new Promise(resolve => setTimeout(resolve, 5000));
        process.exit(1);
    }
}

// Exporta para uso em testes
module.exports = { app, startServer };

// Se executado diretamente, inicia o servidor
if (require.main === module) {
    startServer();
}

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

const requiredEnvVars = [
    'WAPI_URL',
    'WAPI_TOKEN',
    'WAPI_CONNECTION_KEY',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD'
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ Variável de ambiente ${envVar} não definida`);
        process.exit(1);
    }
}
