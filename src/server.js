const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const bodyParser = require('body-parser');

// Serviços
const { GroqServices } = require('./services/groq-services');
const { WebhookService } = require('./services/webhook-service');
const { WhatsAppService } = require('./services/whatsapp-service');
const { AIServices } = require('./services/ai-services');
const AudioService = require('./services/audio-service');
const ImageService = require('./services/image-service');
const businessHours = require('./services/business-hours');

// Configurações
const { RATE_LIMIT_CONFIG } = require('./config/settings');

// Inicializa o app
const app = express();
const port = process.env.PORT || 8080;

// Variáveis de estado
let isReady = false;
let initError = null;

// Serviços
const groqServices = new GroqServices();
const webhookService = new WebhookService();
const whatsappService = new WhatsAppService();
const aiServices = new AIServices(groqServices);

let audioService;
let imageService;

// Função de inicialização
async function initializeServices() {
    try {
        const [client] = await Promise.all([
            whatsappService.getClient(),
            aiServices.initWhatsApp()
        ]);

        audioService = new AudioService(groqServices, client);
        imageService = new ImageService(groqServices, client);
        
        console.log('✅ Serviços inicializados com sucesso');
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
        res.json({ status: 'ok', ready: true });
    } else if (initError) {
        res.status(500).json({ 
            status: 'error', 
            ready: false, 
            error: initError.message 
        });
    } else {
        res.status(503).json({ 
            status: 'initializing', 
            ready: false 
        });
    }
});

// Webhook para mensagens
app.post('/webhook/msg_recebidas_ou_enviadas', async (req, res) => {
    try {
        console.log('📩 Webhook recebido:', JSON.stringify(req.body, null, 2));
        
        // Extrai a mensagem do webhook
        const message = webhookService.extractMessageFromWebhook(req.body);
        
        if (!message) {
            console.log('⚠️ Mensagem inválida ou não suportada');
            return res.sendStatus(200);
        }

        let response;

        // Processa mensagens de texto
        if (message.type === 'text' && message.text) {
            response = await aiServices.processMessage(message.text, {
                from: message.from,
                messageId: message.messageId,
                businessHours: businessHours.isWithinBusinessHours()
            });
        }
        // Processa mensagens de áudio
        else if (message.type === 'audio' && message.audioMessage) {
            if (!audioService) {
                console.error('❌ AudioService não está pronto');
                return res.sendStatus(200);
            }

            try {
                const transcription = await audioService.processWhatsAppAudio({
                    audioMessage: message.audioMessage
                });

                console.log('✅ Áudio transcrito com sucesso:', {
                    length: transcription?.length,
                    preview: transcription?.substring(0, 100)
                });

                response = await aiServices.processMessage(transcription, {
                    from: message.from,
                    messageId: message.messageId,
                    isAudioTranscription: true,
                    businessHours: businessHours.isWithinBusinessHours()
                });
            } catch (error) {
                console.error('❌ Erro ao processar áudio:', error);
                response = 'Desculpe, não consegui processar seu áudio. Por favor, tente enviar uma mensagem de texto.';
            }
        }
        // Processa mensagens de imagem
        else if (message.type === 'image' && message.imageMessage) {
            try {
                response = await imageService.processWhatsAppImage({
                    imageMessage: message.imageMessage,
                    caption: message.caption,
                    from: message.from,
                    messageId: message.messageId,
                    businessHours: businessHours.isWithinBusinessHours()
                });
            } catch (error) {
                console.error('❌ Erro ao processar imagem:', error);
                response = 'Desculpe, não consegui processar sua imagem. Por favor, tente enviar uma mensagem de texto.';
            }
        }

        if (response) {
            console.log('📤 Enviando resposta:', {
                para: message.from,
                resposta: response
            });
        }

    } catch (error) {
        console.error('❌ Erro no webhook:', error);
    }

    res.sendStatus(200);
});

// Função para iniciar o servidor
async function startServer() {
    try {
        await initializeServices();
        
        app.listen(port, () => {
            console.log(`🚀 Servidor rodando na porta ${port}`);
        });
    } catch (error) {
        console.error('❌ Erro fatal ao iniciar servidor:', error);
        process.exit(1);
    }
}

// Exporta para uso em testes
module.exports = { app, startServer };

// Se executado diretamente, inicia o servidor
if (require.main === module) {
    startServer();
}
