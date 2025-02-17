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

            return { 
                type: 'text',
                messageText, 
                customerId: message.from || message.key?.remoteJid?.split('@')[0],
                messageId: message.messageId || message.key?.id,
                timestamp: new Date().toISOString()
            };

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
            console.log('[AIServices] handleMessage - type:', message.type);

            // Se for mensagem de texto
            if (message.type === 'text') {
                const messageData = await this.extractMessageText(message);
                
                console.log('📝 [AIServices] Dados básicos extraídos:', {
                    de: messageData.customerId,
                    timestamp: messageData.timestamp,
                    texto: messageData.messageText,
                    temAudio: false,
                    temDocumento: false
                });

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
                if (response) {
                    await this.whatsAppService.sendText(messageData.customerId, response);
                }

                return {
                    type: 'text',
                    response: response,
                    from: messageData.customerId
                };
            }

            // Se for mensagem de imagem
            if (message.type === 'image') {
                console.log('[AIServices] handleMessage - handling image message');
                const result = await this.handleImageMessage(message);
                if (result?.response) {
                    console.log('[AIServices] handleMessage - sending image response');
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
                    const response = await this.openAIService.processMessage({
                        customerId: message.from,
                        messageId: message.messageId,
                        messageText: transcription,
                        timestamp: new Date().toISOString()
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

            throw new Error(`Tipo de mensagem não suportado: ${message.type}`);

        } catch (error) {
            console.error('ErrorHandlingMessage', {
                error: {
                    message: error.message,
                    stack: error.stack
                },
                messageId: message?.messageId || message?.key?.id,
                timestamp: new Date().toISOString()
            });

            // Tenta enviar mensagem de erro para o usuário
            if (message?.from) {
                await this.sendErrorMessage(message.from, error);
            }

            throw error;
        }
    }

    async sendErrorMessage(to, error) {
        try {
            if (!to) {
                console.warn('⚠️ [AIServices] Destinatário não fornecido para mensagem de erro');
                return;
            }

            let errorContext = '';
            
            // Personaliza contexto baseado no tipo de erro
            if (error.message.includes('Timeout')) {
                errorContext = `
                Contexto: O assistente demorou muito para processar sua solicitação.
                Erro técnico: ${error.message}
                
                Por favor, gere uma mensagem educada explicando que houve um atraso no processamento e pedindo para o cliente tentar novamente.`;
            } 
            else if (error.message.includes('máximo de chamadas')) {
                errorContext = `
                Contexto: O assistente fez muitas tentativas de processar a solicitação.
                Erro técnico: ${error.message}
                
                Por favor, gere uma mensagem educada pedindo para o cliente reformular a solicitação de forma mais clara.`;
            }
            else if (error.message.includes('repetida detectada')) {
                errorContext = `
                Contexto: O assistente entrou em um loop processando a mesma informação.
                Erro técnico: ${error.message}
                
                Por favor, gere uma mensagem educada pedindo para o cliente tentar novamente, possivelmente de outra forma.`;
            }
            else {
                errorContext = `
                Contexto: Ocorreu um erro ao processar a solicitação do cliente.
                Erro técnico: ${error.message}
                
                Por favor, gere uma mensagem educada explicando que houve um problema e sugerindo alternativas.`;
            }

            try {
                // Tenta gerar uma mensagem personalizada via Assistant
                const errorResponse = await this.openAIService.processCustomerMessage(to, {
                    role: 'user',
                    content: errorContext
                });
                await this.whatsAppService.sendText(to, errorResponse);
            } catch (assistantError) {
                // Fallback para mensagem específica baseada no tipo de erro
                console.error('❌ [AIServices] Erro ao gerar mensagem personalizada:', assistantError);
                
                let fallbackMessage = '';
                if (error.message.includes('Timeout')) {
                    fallbackMessage = 'Desculpe, estou demorando um pouco mais que o normal para processar sua solicitação. ' +
                                   'Por favor, tente novamente em alguns instantes.';
                } 
                else if (error.message.includes('máximo de chamadas')) {
                    fallbackMessage = 'Desculpe, estou tendo dificuldade para entender sua solicitação. ' +
                                   'Poderia, por favor, reformular de forma mais clara?';
                }
                else if (error.message.includes('repetida detectada')) {
                    fallbackMessage = 'Desculpe, parece que entrei em um loop processando sua solicitação. ' +
                                   'Poderia tentar novamente de uma forma diferente?';
                }
                else {
                    fallbackMessage = 'Desculpe, ocorreu um erro ao processar sua solicitação. ' +
                                   'Por favor, tente novamente em alguns instantes.';
                }
                
                await this.whatsAppService.sendText(to, fallbackMessage);
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
