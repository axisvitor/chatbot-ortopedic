const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Importações após carregar as variáveis de ambiente
const settings = require('./config/settings');
const services = require('./services');
const express = require('express');
const { OpenAI } = require('openai');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');

// Configuração do Express
const app = express();
const port = process.env.PORT || 1988;

// Configuração de proxy
app.set('trust proxy', 1);

// Middlewares
app.use(bodyParser.json({
    limit: '50mb'
}));
app.use(bodyParser.urlencoded({ 
    limit: '50mb',
    extended: true,
    parameterLimit: 50000
}));

// Rate limiting
app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limite por IP
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            error: 'Too many requests, please try again later.',
            retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
        });
    }
}));

// Inicialização dos serviços
let redisStore, whatsappService, aiServices, trackingService, groqServices;

async function initializeServices() {
    try {
        // Inicializa OpenAI
        const openai = new OpenAI({
            apiKey: settings.OPENAI_CONFIG.apiKey
        });

        // Inicializa serviços
        redisStore = new services.RedisStore();
        await redisStore.connect();

        whatsappService = new services.WhatsAppService();
        groqServices = new services.GroqServices();
        trackingService = new services.TrackingService(redisStore, whatsappService);
        aiServices = new services.AIServices(trackingService, whatsappService, groqServices, redisStore);

        console.log('✅ Todos os serviços inicializados com sucesso');
    } catch (error) {
        console.error('❌ Erro ao inicializar serviços:', error);
        process.exit(1);
    }
}

// Rota padrão para healthcheck
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'Chatbot Ortopedic API is running'
    });
});

// Webhook principal
app.post('/webhook/msg_recebidas_ou_enviadas', async (req, res) => {
    try {
        console.log('📩 Webhook recebido:', JSON.stringify(req.body, null, 2));
        
        // Extrair a mensagem do webhook
        const message = await whatsappService.extractMessageFromWebhook(req.body);
        console.log('📨 Mensagem extraída:', {
            type: message.type,
            from: message.from,
            messageId: message.messageId,
            hasFrom: !!message.from,
            fromType: typeof message.from,
            fromLength: message.from?.length,
            tipoMensagem: message.type
        });

        if (!message.from) {
            throw new Error('Número do remetente não encontrado na mensagem');
        }

        let response = null;

        switch (message.type) {
            case 'text':
                response = await aiServices.processMessage(message.text, {
                    phone: message.from,
                    messageId: message.messageId
                });
                break;

            case 'image':
                console.log('🖼️ Processando imagem...');
                const imageAnalysis = await aiServices.processPaymentProof(message.imageUrl);
                
                if (imageAnalysis.isPaymentProof) {
                    await whatsappService.notifyFinancialDepartment({
                        from: message.from,
                        imageUrl: message.imageUrl,
                        analysis: imageAnalysis.analysis
                    });
                    response = "✅ Comprovante recebido e encaminhado para análise. Em breve retornaremos com a confirmação.";
                } else {
                    response = imageAnalysis;
                }
                break;

            case 'audio':
                console.log('🎵 Processando áudio...', {
                    from: message.from,
                    hasAudioMessage: !!message.audioMessage,
                    hasBuffer: !!message.audioMessage?.buffer,
                    fromType: typeof message.from,
                    fromLength: message.from?.length
                });
                
                try {
                    if (!message.audioMessage) {
                        throw new Error('Dados do áudio não encontrados');
                    }

                    // Passamos a mensagem completa com a estrutura esperada pelo Baileys
                    const transcription = await aiServices.processAudio({
                        message: {
                            audioMessage: message.audioMessage
                        }
                    });
                    console.log('📝 Transcrição recebida:', transcription);
                    
                    if (!transcription) {
                        throw new Error('Transcrição vazia');
                    }

                    // Processa a transcrição como uma mensagem de texto
                    response = await aiServices.processMessage(transcription, {
                        phone: message.from,
                        messageId: message.messageId
                    });
                } catch (error) {
                    console.error('❌ Erro ao processar áudio:', error);
                    response = "Desculpe, não consegui processar o áudio. Por favor, tente novamente ou envie sua mensagem em texto.";
                }
                break;

            case 'document':
                console.log('📄 Documento recebido - não processado');
                response = "Desculpe, ainda não processo documentos. Por favor, envie sua mensagem em texto, áudio ou imagem.";
                break;

            default:
                response = "Desculpe, não consigo processar este tipo de mensagem.";
        }

        if (response) {
            console.log('📤 Enviando resposta:', {
                para: message.from,
                tipo: typeof message.from,
                tamanho: message.from?.length,
                resposta: response
            });
            
            await whatsappService.sendMessage(message.from, response);
        }

    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        
        // Tenta enviar mensagem de erro para o usuário se tivermos o número
        if (req.body?.body?.key?.remoteJid) {
            const userNumber = req.body.body.key.remoteJid.replace('@s.whatsapp.net', '');
            try {
                await whatsappService.sendMessage(
                    userNumber,
                    "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes."
                );
            } catch (sendError) {
                console.error('❌ Erro ao enviar mensagem de erro:', sendError);
            }
        }

        // Propaga o erro para ser tratado pelo middleware de erro
        throw error;
    }

    res.sendStatus(200);
});

// Rota de status
app.get('/status', (req, res) => {
    res.status(200).json({
        status: 'running',
        time: new Date().toISOString(),
        services: {
            redis: redisStore?.isConnected() || false,
            whatsapp: !!whatsappService,
            ai: !!aiServices,
            tracking: !!trackingService,
            groq: !!groqServices
        }
    });
});

// Inicialização do servidor
async function startServer() {
    try {
        await initializeServices();
        app.listen(port, () => {
            console.log(`🚀 Servidor rodando na porta ${port}`);
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar servidor:', error);
        process.exit(1);
    }
}

// Inicia o servidor
startServer();
