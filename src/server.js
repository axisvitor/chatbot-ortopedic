const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { WebhookService } = require('./services/webhook-service');
const { AIServices } = require('./services/ai-services');
const { WhatsAppService } = require('./services/whatsapp-service');
const { AudioService } = require('./services/audio-service');
const { ImageService } = require('./services/image-service');
const { GroqServices } = require('./services/groq-services');
const express = require('express');
const bodyParser = require('body-parser');

// Inicialização do Express
const app = express();
const port = process.env.PORT || 8080;

// Middlewares
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Serviços
const groqServices = new GroqServices();
const webhookService = new WebhookService();
const aiServices = new AIServices();
const whatsappService = new WhatsAppService();
const audioService = new AudioService(groqServices);
const imageService = new ImageService(groqServices);

// Rota de healthcheck
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
        
        // Extrai a mensagem do webhook
        const message = webhookService.extractMessageFromWebhook(req.body);
        
        if (!message) {
            console.log('⚠️ Mensagem não pôde ser extraída do webhook');
            return res.sendStatus(200);
        }

        console.log('📨 Mensagem processada:', {
            type: message.type,
            from: message.from,
            messageId: message.messageId,
            hasText: !!message.text
        });

        let response = null;

        // Processa mensagens de texto
        if (message.type === 'text' && message.text) {
            try {
                response = await aiServices.processMessage(message.text, {
                    from: message.from,
                    messageId: message.messageId
                });
            } catch (error) {
                console.error('❌ Erro ao processar mensagem:', error);
                response = "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes.";
            }
        }
        // Processa mensagens de áudio
        else if (message.type === 'audio' && message.audioMessage) {
            try {
                console.log('🎵 Processando áudio...', {
                    from: message.from,
                    duration: message.audioMessage.seconds,
                    mime: message.audioMessage.mimetype
                });

                // Transcreve o áudio
                const transcription = await audioService.processWhatsAppAudio({
                    audioMessage: message.audioMessage
                });

                if (!transcription) {
                    throw new Error('Falha na transcrição do áudio');
                }

                console.log('🎯 Áudio transcrito:', {
                    length: transcription.length,
                    preview: transcription.substring(0, 100)
                });

                // Processa a transcrição com o OpenAI Assistant
                response = await aiServices.processMessage(transcription, {
                    from: message.from,
                    messageId: message.messageId,
                    isAudioTranscription: true
                });

            } catch (error) {
                console.error('❌ Erro ao processar áudio:', error);
                response = "Desculpe, não consegui processar seu áudio. Por favor, tente enviar uma mensagem de texto.";
            }
        }
        // Processa mensagens de imagem
        else if (message.type === 'image' && message.imageMessage) {
            try {
                console.log('🖼️ Processando imagem...', {
                    from: message.from,
                    mimetype: message.imageMessage.mimetype,
                    size: message.imageMessage.fileLength
                });

                const result = await imageService.processWhatsAppImage({
                    mediaData: message.imageMessage,
                    type: 'image',
                    mimetype: message.imageMessage.mimetype,
                    size: message.imageMessage.fileLength,
                    filename: message.imageMessage.fileName
                });

                if (!result.success) {
                    throw new Error(result.message);
                }

                console.log('🎯 Imagem analisada:', {
                    success: result.success,
                    analysisLength: result.analysis?.length || 0
                });

                // Processa a análise com o OpenAI Assistant
                response = await aiServices.processMessage(
                    `[Análise da imagem: ${result.analysis}] Por favor, me ajude a entender esta imagem.`,
                    {
                        from: message.from,
                        messageId: message.messageId,
                        isImageAnalysis: true
                    }
                );

            } catch (error) {
                console.error('❌ Erro no processamento de imagem:', error);
                
                let errorMessage = "Desculpe, não consegui processar sua imagem. ";
                
                if (error.message.includes('tipo não suportado')) {
                    errorMessage += "Por favor, envie a imagem em formato JPG, PNG ou WebP.";
                } else if (error.message.includes('muito grande')) {
                    errorMessage += "A imagem é muito grande. Por favor, envie uma imagem menor.";
                } else {
                    errorMessage += "Por favor, tente novamente.";
                }
                
                response = errorMessage;
            }
        }

        // Envia a resposta
        if (response) {
            console.log('📤 Enviando resposta:', {
                para: message.from,
                resposta: response
            });
            
            await whatsappService.sendText(message.from, response);
        }

    } catch (error) {
        console.error('❌ Erro no webhook:', error);
    }

    res.sendStatus(200);
});

// Inicia o servidor
app.listen(port, () => {
    console.log(`🚀 Servidor rodando na porta ${port}`);
});
