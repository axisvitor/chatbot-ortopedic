class AIServices {
    constructor(whatsAppService, whatsAppImageService, openAIVisionService, openAIService, audioService) {
        this.whatsAppService = whatsAppService;
        this.whatsAppImageService = whatsAppImageService;
        this.openAIVisionService = openAIVisionService;
        this.openAIService = openAIService;
        this.audioService = audioService;
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
            const response = await this.openAIService.processCustomerMessage(from, {
                role: 'user',
                content: context
            });

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

    async handleMessage(message) {
        try {
            console.log('💬 [AIServices] Processando mensagem:', message);

            // Se for mensagem de imagem
            if (message.type === 'image') {
                return this.handleImageMessage(message);
            }

            // Se for mensagem de áudio
            if (message.type === 'audio' || message.type === 'ptt') {
                const result = await this.audioService.processWhatsAppAudio(message);
                
                // Se houve erro no processamento do áudio
                if (result.error) {
                    return {
                        type: 'error',
                        message: result.message,
                        from: message.from
                    };
                }

                // Processa a transcrição com o OpenAI
                const response = await this.openAIService.processCustomerMessage(message.from, {
                    role: 'user',
                    content: `Transcrição do áudio do cliente: "${result}"`
                });

                return {
                    type: 'audio',
                    transcription: result,
                    response: response,
                    from: message.from
                };
            }

            // Se for mensagem de texto
            if (message.type === 'text') {
                const response = await this.openAIService.processCustomerMessage(message.from, {
                    role: 'user',
                    content: message.text
                });
                return {
                    type: 'text',
                    response: response,
                    from: message.from
                };
            }

            throw new Error(`Tipo de mensagem não suportado: ${message.type}`);

        } catch (error) {
            console.error('❌ [AIServices] Erro ao processar mensagem:', error);
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