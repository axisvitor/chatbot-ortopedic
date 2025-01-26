class AIServices {
    constructor(whatsAppService, whatsAppImageService, openAIService, openAIVisionService, audioService) {
        this.whatsAppService = whatsAppService;
        this.whatsAppImageService = whatsAppImageService;
        this.openAIService = openAIService;
        this.openAIVisionService = openAIVisionService;
        this.audioService = audioService;

        if (!whatsAppService) throw new Error('WhatsAppService é obrigatório');
        if (!whatsAppImageService) throw new Error('WhatsAppImageService é obrigatório');
        if (!openAIService) throw new Error('OpenAIService é obrigatório');
        if (!openAIVisionService) throw new Error('OpenAIVisionService é obrigatório');
        if (!audioService) throw new Error('AudioService é obrigatório');

        console.log('[AIServices] Serviço inicializado com:', {
            hasWhatsApp: !!whatsAppService,
            hasWhatsAppImage: !!whatsAppImageService,
            hasOpenAI: !!openAIService,
            hasOpenAIVision: !!openAIVisionService,
            hasAudio: !!audioService,
            timestamp: new Date().toISOString()
        });
    }

    async handleImageMessage(message) {
        try {
            const from = message.key?.remoteJid?.replace('@s.whatsapp.net', '');
            
            console.log('🖼️ [AIServices] Processando mensagem de imagem:', { from });

            // Download da imagem
            const imageData = await this.whatsAppImageService.downloadImage(message);
            if (!imageData?.buffer) {
                throw new Error('Falha ao baixar imagem');
            }

            // Processa a imagem com OpenAI Vision
            const analysis = await this.openAIVisionService.processImage({
                buffer: imageData.buffer,
                mimetype: imageData.mimetype,
                caption: imageData.caption
            });

            // Prepara o contexto para o Assistant
            const context = `
            Contexto: Analisando uma imagem enviada pelo cliente.
            ${imageData.caption ? `O cliente disse: "${imageData.caption}"` : ''}
            
            Análise detalhada da imagem:
            ${analysis}
            
            Por favor, responda de forma natural e amigável, como se estivesse conversando com o cliente.
            Se a imagem mostrar algum problema médico ou ortopédico, forneça orientações gerais e sugira consultar um profissional.
            `;

            // Gera resposta personalizada via Assistant
            const response = await this.openAIService.processCustomerMessageWithImage(
                from,
                context,
                [{
                    mimetype: imageData.mimetype,
                    base64: imageData.buffer.toString('base64')
                }]
            );

            return {
                type: 'image_analysis',
                analysis: analysis,
                response: response,
                from: from
            };

        } catch (error) {
            console.error('❌ [AIServices] Erro ao processar imagem:', error);
            throw error;
        }
    }

    extractMessageText(message) {
        try {
            let messageText = '';

            // Verifica mensagem extendida
            if (message.message?.extendedTextMessage?.text) {
                messageText = message.message.extendedTextMessage.text;
            }
            // Verifica mensagem direta
            else if (message.message?.conversation) {
                messageText = message.message.conversation;
            }
            // Verifica texto direto
            else if (message.text) {
                messageText = message.text;
            }

            // Valida e limpa o texto
            if (typeof messageText !== 'string') {
                throw new Error('Texto da mensagem inválido');
            }

            messageText = messageText.trim();

            if (!messageText) {
                throw new Error('Texto da mensagem vazio');
            }

            console.log('MessageTextExtracted', {
                messageId: message.messageId,
                textLength: messageText.length,
                timestamp: new Date().toISOString()
            });

            return { messageText };

        } catch (error) {
            console.error('ErrorExtractingMessageText', {
                error: {
                    message: error.message,
                    stack: error.stack
                },
                messageId: message?.messageId,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    async handleMessage(message) {
        try {
            // Se for mensagem de imagem
            if (message.type === 'image') {
                const result = await this.handleImageMessage(message);
                if (result?.response) {
                    await this.whatsAppService.sendText(result.from, result.response);
                }
                return result;
            }

            // Se for mensagem de áudio
            if (message.type === 'audio' || message.type === 'ptt') {
                console.log('ProcessingAudioMessage', {
                    from: message.from,
                    seconds: message?.message?.audioMessage?.seconds,
                    mimetype: message?.message?.audioMessage?.mimetype
                });

                try {
                    // Processa o áudio usando o AudioService
                    const transcription = await this.audioService.processWhatsAppAudio(message);
                    
                    if (!transcription || transcription.error) {
                        throw new Error(transcription?.message || 'Falha ao transcrever áudio');
                    }

                    console.log('AudioTranscribed', { transcription });
                    
                    // Processa com o OpenAI Assistant
                    const response = await this.openAIService.processCustomerMessage(message.from, {
                        role: 'user',
                        transcription: transcription
                    });

                    if (response) {
                        await this.whatsAppService.sendText(message.from, response);
                    }

                    return {
                        type: 'audio',
                        transcription,
                        response,
                        from: message.from
                    };
                } catch (error) {
                    console.error('ErrorProcessingAudio', {
                        error: {
                            message: error.message,
                            stack: error.stack
                        },
                        from: message.from
                    });
                    const errorMsg = 'Desculpe, não consegui processar seu áudio. Por favor, tente enviar novamente ou envie como mensagem de texto.';
                    await this.whatsAppService.sendText(message.from, errorMsg);
                    throw error;
                }
            }

            // Se for mensagem de texto
            if (message.type === 'text') {
                // Extrai e valida o texto
                const { messageText } = this.extractMessageText(message);

                // Prepara os dados para o OpenAI
                const messageData = {
                    customerId: message.from || message.key?.remoteJid?.split('@')[0],
                    messageText: messageText.trim(),
                    messageId: message.messageId || message.key?.id,
                    timestamp: new Date().toISOString()
                };

                // Valida os dados antes de processar
                if (!messageData.customerId || !messageData.messageText) {
                    throw new Error('Dados da mensagem inválidos');
                }

                console.log('ProcessingTextMessage', {
                    messageId: messageData.messageId,
                    customerId: messageData.customerId,
                    messageLength: messageData.messageText.length,
                    timestamp: messageData.timestamp
                });

                // Processa a mensagem
                const response = await this.openAIService.processMessage(messageData);

                // Envia a resposta
                if (response?.response) {
                    await this.whatsAppService.sendText(messageData.customerId, response.response);
                }

                return response;
            }

            throw new Error(`Tipo de mensagem não suportado: ${message.type}`);

        } catch (error) {
            console.error('ErrorHandlingMessage', {
                error: {
                    message: error.message,
                    stack: error.stack,
                    code: error.code
                },
                messageId: message?.messageId || message?.key?.id,
                timestamp: new Date().toISOString()
            });

            // Envia mensagem de erro para o usuário
            const errorMessage = '❌ Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes.';
            await this.whatsAppService.sendText(message.from || message.key?.remoteJid?.split('@')[0], errorMessage);

            throw error;
        }
    }

    async sendErrorMessage(to, error) {
        try {
            if (!to) {
                console.warn('⚠️ [AIServices] Destinatário não fornecido para mensagem de erro');
                return;
            }

            const errorContext = `
            Contexto: Ocorreu um erro ao processar a imagem do cliente.
            Erro técnico: ${error.message}
            
            Por favor, gere uma mensagem educada explicando o problema e sugerindo alternativas.
            Mantenha a mensagem curta e clara.`;

            try {
                // Tenta gerar uma mensagem personalizada via Assistant
                const errorResponse = await this.openAIService.processCustomerMessage(to, {
                    role: 'user',
                    content: errorContext
                });
                await this.whatsAppService.sendText(to, errorResponse);
            } catch (assistantError) {
                // Fallback para mensagem padrão em caso de erro do Assistant
                console.error('❌ [AIServices] Erro ao gerar mensagem personalizada:', assistantError);
                const defaultError = 'Desculpe, não consegui processar sua imagem. ' +
                                   'Por favor, tente enviar novamente ou envie em outro formato (JPEG ou PNG).';
                await this.whatsAppService.sendText(to, defaultError);
            }
        } catch (sendError) {
            console.error('❌ [AIServices] Erro ao enviar mensagem de erro:', {
                erro: sendError.message,
                destinatario: to
            });
        }
    }
}

module.exports = { AIServices };