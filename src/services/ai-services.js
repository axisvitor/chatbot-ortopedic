const { WhatsAppService } = require('./whatsapp-service');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { RedisStore } = require('../store/redis-store');
const { OpenAIService } = require('./openai-service');
const { TrackingService } = require('./tracking-service');
const { BusinessHoursService } = require('./business-hours');
const { OrderValidationService } = require('./order-validation-service');
const { NuvemshopService } = require('./nuvemshop-service');
const { GroqServices } = require('./groq-services');
const { AudioService } = require('./audio-service');

class AIServices {
    constructor(whatsAppService, whatsAppImageService, redisStore, openAIService, trackingService, orderValidationService, nuvemshopService, businessHoursService) {
        this.whatsAppService = whatsAppService || new WhatsAppService();
        this.whatsAppImageService = whatsAppImageService || new WhatsAppImageService(this.whatsAppService, new GroqServices());
        this.redisStore = redisStore || new RedisStore();
        this.trackingService = trackingService || new TrackingService();
        this.businessHoursService = businessHoursService || new BusinessHoursService();
        this.orderValidationService = orderValidationService || new OrderValidationService();
        this.nuvemshopService = nuvemshopService || new NuvemshopService();
        this.openAIService = openAIService || new OpenAIService(
            this.nuvemshopService,
            this.trackingService,
            this.businessHoursService,
            this.orderValidationService
        );
        this.audioService = new AudioService();
        this.groqServices = new GroqServices();
    }

    /**
     * Recupera ou cria o histórico de chat para um usuário
     * @param {string} from Número do usuário
     * @returns {Promise<Object>} Histórico do chat
     */
    async getChatHistory(from) {
        const threadKey = `chat:${from}`;
        try {
            const rawHistory = await this.redisStore.get(threadKey);
            let chatHistory = typeof rawHistory === 'string' ? JSON.parse(rawHistory) : rawHistory;
            
            if (!chatHistory?.threadId) {
                console.log('🔄 Criando novo thread:', {
                    key: threadKey,
                    from,
                    timestamp: new Date().toISOString()
                });

                const thread = await this.openAIService.createThread();
                chatHistory = {
                    threadId: thread.id,
                    lastUpdate: new Date().toISOString(),
                    messages: []
                };

                await this.redisStore.set(threadKey, JSON.stringify(chatHistory));
            }

            return chatHistory;
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            throw error;
        }
    }

    /**
     * Processa informações do pedido e envia resposta ao cliente
     * @param {string} from Número do cliente
     * @param {Object} orderInfo Informações do pedido
     */
    async handleOrderInfo(from, orderInfo) {
        try {
            let response = await this.formatOrderResponse(orderInfo);
            
            // Se tiver código de rastreio, adiciona informações de tracking
            if (orderInfo.shipping_tracking_number) {
                const tracking = await this.trackingService.getTrackingInfo(orderInfo.shipping_tracking_number);
                if (tracking) {
                    response += '\n\n' + await this.formatOrderTrackingResponse(tracking);
                }
            }

            await this.whatsAppService.sendText(from, response);
        } catch (error) {
            console.error('[AI] Erro ao processar informações do pedido:', error);
            await this.whatsAppService.sendText(
                from,
                'Desculpe, ocorreu um erro ao processar as informações do pedido. Por favor, tente novamente mais tarde.'
            );
        }
    }

    async handleMessage(messageData) {
        try {
            const { from, text, type, imageUrl } = messageData;

            // Registra a mensagem recebida
            console.log('📨 Mensagem recebida:', {
                tipo: type,
                de: from,
                messageId: messageData.messageId,
                timestamp: new Date().toISOString()
            });

            // Recupera o histórico da conversa
            const chatHistory = await this.getChatHistory(from);
            console.log('📜 Histórico recuperado:', {
                key: `chat:${from}`,
                threadId: chatHistory.threadId,
                mensagens: chatHistory.messages?.length,
                ultimaMensagem: chatHistory.lastMessage,
                ultimaAtualizacao: chatHistory.lastUpdate,
                timestamp: new Date().toISOString()
            });

            // Verifica se a mensagem já foi processada
            const processKey = `ai_processed:${messageData.messageId}`;
            const wasProcessed = await this.redisStore.get(processKey);
            
            if (wasProcessed) {
                console.log('⚠️ Mensagem já processada pelo AI:', {
                    messageId: messageData.messageId,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            try {
                // Se for uma imagem, processa primeiro
                if (type === 'image') {
                    console.log('🖼️ Processando imagem...');
                    
                    // Tenta extrair número do pedido primeiro
                    const orderNumber = await this.orderValidationService.extractOrderNumber(imageUrl);
                    if (orderNumber) {
                        console.log(`🔍 Número do pedido encontrado na imagem: ${orderNumber}`);
                        const orderInfo = await this.orderValidationService.findOrder(orderNumber);
                        
                        if (orderInfo) {
                            await this.handleOrderInfo(from, orderInfo);
                        } else {
                            await this.whatsAppService.sendText(
                                from,
                                'Não encontrei nenhum pedido com esse número. Por favor, verifique se o número está correto e tente novamente.'
                            );
                        }
                    } else {
                        // Se não for pedido, processa como imagem normal
                        await this.handleImageMessage(messageData);
                    }
                    
                    // Marca como processado após sucesso
                    await this.redisStore.set(processKey, 'true');
                    return null;
                }

                // Se for áudio, processa com transcrição
                if (messageData.audioMessage) {
                    const transcription = await this.handleAudioMessage(messageData);
                    if (transcription) {
                        // Adiciona a transcrição ao thread
                        await this.openAIService.addMessage(chatHistory.threadId, {
                            role: 'user',
                            content: transcription
                        });
                        
                        // Executa o assistant e aguarda resposta
                        const run = await this.openAIService.runAssistant(chatHistory.threadId);
                        const response = await this.openAIService.waitForResponse(chatHistory.threadId, run.id);

                        // Atualiza o histórico
                        chatHistory.messages = chatHistory.messages || [];
                        chatHistory.messages.unshift(
                            {
                                role: 'user',
                                content: transcription,
                                type: 'audio',
                                timestamp: new Date().toISOString()
                            },
                            {
                                role: 'assistant',
                                content: response,
                                timestamp: new Date().toISOString()
                            }
                        );
                        
                        chatHistory.lastUpdate = new Date().toISOString();
                        await this.redisStore.set(`chat:${from}`, JSON.stringify(chatHistory));
                        await this.sendResponse(from, response);
                        
                        // Marca como processado após sucesso
                        await this.redisStore.set(processKey, 'true');
                        return null;
                    }
                }

                // Verifica se é um comando especial
                if (text?.toLowerCase() === '#resetid') {
                    const response = await this.handleResetCommand(messageData);
                    await this.sendResponse(from, response);
                    await this.redisStore.set(processKey, 'true');
                    return null;
                }

                // Verifica timeout de estados
                const waitingFor = await this.redisStore.get(`waiting_order:${messageData.from}`);
                const waitingSince = await this.redisStore.get(`waiting_since:${messageData.from}`);
                
                if (waitingFor && waitingSince) {
                    const waitingTime = Date.now() - new Date(waitingSince).getTime();
                    if (waitingTime > 30 * 60 * 1000) { // 30 minutos
                        await this.redisStore.del(`waiting_order:${messageData.from}`);
                        await this.redisStore.del(`waiting_since:${messageData.from}`);
                        waitingFor = null;
                    }
                }

                // Verifica se é uma solicitação de atendimento humano
                if (text?.toLowerCase().includes('atendente') || 
                    text?.toLowerCase().includes('humano') || 
                    text?.toLowerCase().includes('pessoa')) {
                    
                    const isBusinessHours = this.businessHoursService.isWithinBusinessHours();
                    if (!isBusinessHours) {
                        console.log('⏰ Fora do horário comercial para atendimento humano');
                        const response = this.businessHoursService.getOutOfHoursMessage();
                        await this.sendResponse(from, response);
                        await this.redisStore.set(processKey, 'true');
                        return null;
                    }
                }

                // Verifica se parece uma saudação
                const saudacoes = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'];
                if (text && saudacoes.some(s => text.toLowerCase().includes(s))) {
                    console.log('👋 Saudação detectada:', {
                        texto: text,
                        de: from,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Adiciona a mensagem ao thread
                    await this.openAIService.addMessage(chatHistory.threadId, {
                        role: 'user',
                        content: text
                    });
                    
                    // Executa o assistant e aguarda resposta
                    const run = await this.openAIService.runAssistant(chatHistory.threadId);
                    const response = await this.openAIService.waitForResponse(chatHistory.threadId, run.id);

                    // Atualiza o histórico
                    chatHistory.messages = chatHistory.messages || [];
                    chatHistory.messages.unshift(
                        {
                            role: 'user',
                            content: text,
                            timestamp: new Date().toISOString()
                        },
                        {
                            role: 'assistant',
                            content: response,
                            timestamp: new Date().toISOString()
                        }
                    );

                    chatHistory.lastUpdate = new Date().toISOString();
                    await this.redisStore.set(`chat:${from}`, JSON.stringify(chatHistory));
                    await this.sendResponse(from, response);
                    await this.redisStore.set(processKey, 'true');
                    return null;
                }

                // Verifica se é uma solicitação de rastreamento
                const trackingKeywords = ['rastrear', 'status da entrega', 'status do pedido'];
                if (text && trackingKeywords.some(keyword => text.toLowerCase().includes(keyword))) {
                    try {
                        // Primeiro tenta recuperar código de rastreio do cache
                        const trackingKey = `tracking:${from}`;
                        const trackingNumber = await this.redisStore.get(trackingKey);

                        if (trackingNumber) {
                            const trackingStatus = await this.orderValidationService.getTrackingStatus(trackingNumber);
                            if (trackingStatus) {
                                await this.sendResponse(from, trackingStatus);
                                await this.redisStore.set(processKey, 'true');
                                return null;
                            }
                        }

                        // Se não encontrou código de rastreio, verifica pedido em cache
                        const orderKey = `order:${from}`;
                        const orderNumber = await this.redisStore.get(orderKey);

                        if (orderNumber) {
                            const order = await this.orderValidationService.validateOrderNumber(orderNumber);
                            if (order) {
                                const orderResponse = await this.orderValidationService.formatOrderMessage(order, from);
                                if (orderResponse) {
                                    await this.sendResponse(from, orderResponse);
                                    await this.redisStore.set(processKey, 'true');
                                    return null;
                                }
                            }
                        }

                        await this.sendResponse(from, 'Por favor, me informe o número do seu pedido para que eu possa verificar o status de entrega.');
                        await this.redisStore.set(processKey, 'true');
                        return null;
                    } catch (error) {
                        console.error('❌ Erro ao processar rastreamento:', error);
                        await this.sendResponse(from, 'Desculpe, não foi possível verificar o status do rastreamento no momento. Por favor, tente novamente mais tarde.');
                        await this.redisStore.set(processKey, 'true');
                        return null;
                    }
                }

                // Verifica se é um número de pedido ou pedido internacional
                const orderNumber = await this.orderValidationService.extractOrderNumber(text);
                const orderKeywords = ['pedido', 'encomenda', 'compra', 'gostaria de saber'];
                const hasOrderKeywords = orderKeywords.some(keyword => 
                    text?.toLowerCase().includes(keyword)
                );

                // Se tem palavras relacionadas a pedido
                if (hasOrderKeywords) {
                    console.log('🔍 Pergunta sobre pedido detectada:', {
                        texto: text,
                        temNumero: !!orderNumber,
                        de: from,
                        timestamp: new Date().toISOString()
                    });

                    // Se não tem número de pedido, pede para informar
                    if (!orderNumber) {
                        await this.sendResponse(from, 'Por favor, me informe o número do seu pedido para que eu possa verificar as informações para você.');
                        await this.redisStore.set(processKey, 'true');
                        return null;
                    }

                    try {
                        const order = await this.nuvemshopService.getOrder(orderNumber);
                        
                        // Se for pedido internacional
                        if (order?.shipping_address?.country !== 'BR') {
                            console.log('🌍 Pedido internacional detectado:', {
                                numero: orderNumber,
                                pais: order.shipping_address.country,
                                timestamp: new Date().toISOString()
                            });
                            await this.whatsAppService.forwardToFinancial(messageData, orderNumber);
                            await this.redisStore.set(processKey, 'true');
                            return null;
                        }

                        // Processa pedido normal
                        if (order) {
                            await this.handleOrderInfo(from, order);
                        } else {
                            await this.sendResponse(from, 'Não encontrei nenhum pedido com esse número. Por favor, verifique se o número está correto.');
                        }
                    } catch (error) {
                        console.error('❌ Erro ao processar pedido:', {
                            erro: error.message,
                            numero: orderNumber,
                            de: from,
                            timestamp: new Date().toISOString()
                        });
                        await this.sendResponse(from, 'Por favor, me informe o número do seu pedido para que eu possa verificar as informações para você.');
                    }
                    
                    await this.redisStore.set(processKey, 'true');
                    return null;
                }

                // Se chegou aqui, é uma mensagem normal para o assistant
                console.log('💬 Processando mensagem normal com assistant');
                
                // Adiciona a mensagem ao thread
                await this.openAIService.addMessage(chatHistory.threadId, {
                    role: 'user',
                    content: text
                });
                
                // Executa o assistant e aguarda resposta
                const run = await this.openAIService.runAssistant(chatHistory.threadId);
                const response = await this.openAIService.waitForResponse(chatHistory.threadId, run.id);

                // Atualiza o histórico
                chatHistory.messages = chatHistory.messages || [];
                chatHistory.messages.unshift(
                    {
                        role: 'user',
                        content: text,
                        timestamp: new Date().toISOString()
                    },
                    {
                        role: 'assistant',
                        content: response,
                        timestamp: new Date().toISOString()
                    }
                );

                chatHistory.lastUpdate = new Date().toISOString();
                await this.redisStore.set(`chat:${from}`, JSON.stringify(chatHistory));
                await this.sendResponse(from, response);
                
                // Marca como processado após sucesso
                await this.redisStore.set(processKey, 'true');

            } catch (error) {
                console.error('❌ Erro ao processar mensagem:', {
                    erro: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });
                throw error;
            }
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            // Tenta enviar mensagem de erro genérica
            try {
                await this.whatsAppService.sendText(
                    from,
                    'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.'
                );
            } catch (fallbackError) {
                console.error('❌ Erro ao enviar mensagem de fallback:', fallbackError);
            }

            return null;
        }
    }

    async sendResponse(to, response) {
        try {
            if (!to || !response) {
                console.error('❌ Parâmetros inválidos em sendResponse:', {
                    to,
                    hasResponse: !!response,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Se a resposta for um objeto, tenta extrair a mensagem
            let messageText = response;
            if (typeof response === 'object' && response !== null) {
                // Se for uma resposta da API, não enviar novamente
                if (response.success !== undefined && response.messageId) {
                    return response;
                }
                messageText = response.message || response.text || response.content || 'Não foi possível processar sua solicitação. Por favor, tente novamente.';
            }

            // Garante que a mensagem é uma string
            messageText = String(messageText).trim();

            // Não envia mensagens vazias
            if (!messageText) {
                console.error('❌ Mensagem vazia:', {
                    para: to,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            console.log('📤 Enviando resposta:', {
                para: to,
                preview: messageText.substring(0, 100),
                tamanho: messageText.length,
                timestamp: new Date().toISOString()
            });

            // Envia a mensagem via WhatsApp
            const result = await this.whatsAppService.sendText(to, messageText);
            
            if (!result) {
                throw new Error('Erro ao enviar mensagem');
            }

            console.log('✅ Resposta enviada:', {
                messageId: result.messageId,
                para: to,
                preview: messageText.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            return result;

        } catch (error) {
            console.error('❌ Erro ao enviar resposta:', {
                para: to,
                erro: error.message,
                timestamp: new Date().toISOString()
            });

            // Tenta enviar mensagem de erro genérica
            try {
                await this.whatsAppService.sendText(
                    to,
                    'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.'
                );
            } catch (fallbackError) {
                console.error('❌ Erro ao enviar mensagem de fallback:', fallbackError);
            }

            return null;
        }
    }

    async handleResetCommand(message) {
        try {
            // Pega o threadId atual
            const threadKey = `chat:${message.from}`;
            const currentThreadId = await this.redisStore.get(threadKey)?.threadId;
            
            // Se existir um thread antigo, tenta deletá-lo
            if (currentThreadId) {
                await this.openAIService.deleteThread(currentThreadId);
            }
            
            // Cria um novo thread
            const newThread = await this.openAIService.createThread();
            
            // Salva o novo threadId no Redis
            await this.redisStore.set(threadKey, {
                threadId: newThread.id,
                lastUpdate: new Date().toISOString()
            });
            
            // Limpa outras chaves relacionadas ao usuário
            const userPrefix = `user:${message.from}:*`;
            await this.redisStore.deletePattern(userPrefix);
            
            console.log('🔄 Histórico resetado com sucesso:', {
                usuario: message.from,
                threadAntigo: currentThreadId,
                novoThreadId: newThread.id,
                timestamp: new Date().toISOString()
            });
            
            return '✅ Histórico de mensagens resetado com sucesso!\n\nVocê pode começar uma nova conversa agora. Use este comando sempre que quiser começar do zero.';
        } catch (error) {
            console.error('❌ Erro ao resetar histórico:', {
                usuario: message.from,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            return '❌ Desculpe, ocorreu um erro ao resetar o histórico. Por favor, tente novamente em alguns instantes.';
        }
    }

    async validateOrderForReceipt(from, orderNumber) {
        try {
            // Busca o pedido na Nuvemshop
            const order = await this.nuvemshopService.getOrder(orderNumber);
            
            if (!order) {
                return null;
            }

            // Verifica se o pedido pertence ao cliente
            const customerPhone = order.customer?.phone?.replace(/\D/g, '');
            const fromPhone = from.replace(/\D/g, '');

            if (!customerPhone || !customerPhone.includes(fromPhone)) {
                console.log('❌ Pedido não pertence ao cliente:', {
                    orderNumber,
                    customerPhone,
                    fromPhone
                });
                return null;
            }

            return order;
        } catch (error) {
            console.error('❌ Erro ao validar pedido:', error);
            return null;
        }
    }

    /**
     * Processa uma mensagem de imagem
     * @param {Object} message Mensagem recebida
     */
    async handleImageMessage(message) {
        try {
            if (!message) {
                throw new Error('Mensagem inválida');
            }

            const { from, type, messageId } = message;

            // Log detalhado da mensagem recebida
            console.log('🖼️ Mensagem de imagem recebida:', {
                messageId,
                from,
                type,
                hasMessage: !!message.message,
                hasImageMessage: !!message.message?.imageMessage,
                timestamp: new Date().toISOString()
            });

            // Verifica se temos o objeto de mensagem completo
            if (!message.message?.imageMessage) {
                console.error('❌ Objeto de imagem não encontrado:', {
                    messageId,
                    from,
                    messageKeys: Object.keys(message),
                    timestamp: new Date().toISOString()
                });
                throw new Error('Objeto de imagem não encontrado na mensagem');
            }

            // Verifica se está esperando comprovante
            const waitingFor = await this.redisStore.get(`waiting_order:${from}`);
            if (waitingFor === 'payment_proof') {
                console.log('💰 Recebido possível comprovante de pagamento');
                
                // Baixa a imagem usando o Baileys
                const buffer = await this.whatsAppService.downloadMediaMessage(message);
                if (!buffer || buffer.length < 100) {
                    throw new Error('Buffer da imagem inválido ou muito pequeno');
                }

                // Analisa com Groq para verificar se é realmente um comprovante
                const base64Image = buffer.toString('base64');
                const isPaymentProof = await this.analyzeImageWithGroq(base64Image);
                
                if (isPaymentProof) {
                    // Salva o comprovante temporariamente
                    const proofKey = `payment_proof:${from}`;
                    await this.redisStore.set(proofKey, message.message, 'EX', 300); // Expira em 5 minutos
                    
                    await this.whatsAppService.sendText(
                        from,
                        'Ótimo! Agora me confirme o número do pedido para que eu possa vincular o comprovante.'
                    );
                    return;
                } else {
                    await this.whatsAppService.sendText(
                        from,
                        'Esta imagem não parece ser um comprovante de pagamento válido. Por favor, envie uma foto clara do comprovante.'
                    );
                    return;
                }
            }

            // Se não estiver esperando comprovante, tenta extrair número do pedido
            try {
                // Primeiro tenta baixar e processar a imagem
                const buffer = await this.whatsAppService.downloadMediaMessage(message);
                if (!buffer || buffer.length < 100) {
                    throw new Error('Buffer da imagem inválido ou muito pequeno');
                }

                const orderNumber = await this.orderValidationService.extractOrderNumber(buffer);
                if (orderNumber) {
                    console.log(`🔍 Número do pedido encontrado na imagem: ${orderNumber}`);
                    const orderInfo = await this.orderValidationService.findOrder(orderNumber);
                    
                    if (orderInfo) {
                        await this.handleOrderInfo(from, orderInfo);
                        return;
                    } else {
                        await this.whatsAppService.sendText(
                            from,
                            'Não encontrei nenhum pedido com esse número. Por favor, verifique se o número está correto e tente novamente.'
                        );
                        return;
                    }
                }

                // Se não encontrou número do pedido, analisa com Groq
                const base64Image = buffer.toString('base64');
                const analysis = await this.analyzeImageWithGroq(base64Image);
                
                // Atualiza o histórico com a análise
                const threadKey = `chat:${from}`;
                let chatHistory = await this.getChatHistory(from);
                
                chatHistory.messages = chatHistory.messages || [];
                chatHistory.messages.unshift(
                    {
                        role: 'user',
                        content: 'Analisar imagem',
                        type: 'image',
                        timestamp: new Date().toISOString()
                    },
                    {
                        role: 'assistant',
                        content: analysis,
                        timestamp: new Date().toISOString()
                    }
                );

                chatHistory.lastUpdate = new Date().toISOString();
                await this.redisStore.set(threadKey, JSON.stringify(chatHistory));

                // Envia a análise para o usuário
                await this.whatsAppService.sendText(
                    from,
                    `🖼️ *Análise da imagem:*\n\n${analysis}`
                );

            } catch (error) {
                console.error('[AI] Erro ao processar imagem:', error);
                await this.whatsAppService.sendText(
                    from,
                    'Desculpe, não consegui processar sua imagem. Por favor, tente novamente ou envie uma mensagem de texto.'
                );
            }
        } catch (error) {
            console.error('[AI] Erro ao processar imagem:', error);
            throw error;
        }
    }

    /**
     * Analisa uma imagem usando o Groq Vision
     * @param {string} base64Image Imagem em base64
     * @returns {Promise<string>} Análise da imagem
     */
    async analyzeImageWithGroq(base64Image) {
        const messages = [
            {
                role: "user", 
                content: [
                    {
                        type: "text",
                        text: "Analise esta imagem e me diga se é um comprovante de pagamento válido. Forneça detalhes como valor, data e outros dados relevantes se houver."
                    },
                    {
                        type: "image_url",
                        image_url: {
                            "url": `data:image/jpeg;base64,${base64Image}`,
                            "detail": "high"
                        }
                    }
                ]
            }
        ];

        const response = await this.groqServices.chat.completions.create({
            model: "llama-3.2-11b-vision-preview",
            messages: messages,
            temperature: 0.7,
            max_tokens: 1024,
            stream: false
        });

        if (!response?.choices?.[0]?.message?.content) {
            throw new Error('Resposta inválida da Groq');
        }

        return response.choices[0].message.content;
    }

    async handleAudioMessage(message) {
        const { messageId, from } = message;

        try {
            // Processa o áudio e obtém a transcrição
            const transcription = await this.audioService.processWhatsAppAudio(message);

            if (!transcription || typeof transcription === 'object' && transcription.error) {
                console.error('❌ Erro ao processar áudio:', {
                    messageId,
                    erro: transcription?.error ? transcription.message : 'Transcrição vazia',
                    timestamp: new Date().toISOString()
                });
                
                await this.sendResponse(
                    from,
                    'Desculpe, não consegui processar sua mensagem de voz. Por favor, tente novamente ou envie uma mensagem de texto.'
                );
                return null;
            }

            console.log('📝 Áudio transcrito:', {
                messageId,
                transcriptionLength: transcription.length,
                preview: transcription.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            return transcription;

        } catch (error) {
            console.error('❌ Erro ao processar áudio:', {
                erro: error.message,
                stack: error.stack,
                messageId,
                from,
                timestamp: new Date().toISOString()
            });

            await this.sendResponse(
                from,
                'Desculpe, não consegui processar sua mensagem de voz. Por favor, tente novamente ou envie uma mensagem de texto.'
            );
            return null;
        }
    }

    async handleOrderMessage(message) {
        console.log('🔄 Processando mensagem de pedido:', message.body);

        try {
            // Busca pedido de forma inteligente
            const order = await this.orderValidationService.findOrderSmart(
                message.body,
                message.from
            );

            if (!order) {
                return this.orderValidationService.formatOrderNotFoundMessage(message.body);
            }

            // Formata resposta com informações do pedido
            const orderInfo = await this.orderValidationService.formatSafeOrderInfo(order);
            return this.orderValidationService.formatOrderMessage(orderInfo, message.from);

        } catch (error) {
            console.error('❌ Erro ao processar mensagem de pedido:', error);
            return `Desculpe, ocorreu um erro ao buscar seu pedido. Por favor, tente novamente em alguns minutos.`;
        }
    }

    formatProductResponse(product) {
        if (!product) return 'Produto não encontrado.';
        
        return `*${product.name}*\n` +
               `Preço: R$ ${(product.price / 100).toFixed(2)}\n` +
               `SKU: ${product.sku || 'N/A'}\n` +
               `Estoque: ${product.stock || 0} unidades\n` +
               `${product.description || ''}\n\n` +
               `Link: ${product.permalink || 'N/A'}`;
    }

    formatProductListResponse(products) {
        if (!products || !products.length) return 'Nenhum produto encontrado.';
        
        return products.map(product => 
            `• *${product.name}*\n` +
            `  Preço: R$ ${(product.price / 100).toFixed(2)}\n` +
            `  SKU: ${product.sku || 'N/A'}`
        ).join('\n\n');
    }

    formatOrderResponse(order) {
        if (!order) return 'Pedido não encontrado.';
        
        return `*Pedido #${order.number}*\n` +
               `Status: ${this.translateOrderStatus(order.status)}\n` +
               `Data: ${new Date(order.created_at).toLocaleDateString('pt-BR')}\n` +
               `Total: R$ ${(order.total / 100).toFixed(2)}\n\n` +
               `*Itens:*\n${this.formatOrderItems(order.items)}`;
    }

    formatOrderTrackingResponse(trackingCode) {
        if (!trackingCode) return 'Código de rastreamento não disponível.';
        return `*Código de Rastreamento:* ${trackingCode}\n` +
               `Rastreie seu pedido em: https://www.linkcorreto.com.br/track/${trackingCode}`;
    }

    formatOrderTotalResponse(total) {
        if (!total && total !== 0) return 'Total do pedido não disponível.';
        return `*Total do Pedido:* R$ ${(total / 100).toFixed(2)}`;
    }

    formatOrderPaymentStatusResponse(paymentStatus) {
        if (!paymentStatus) return 'Status de pagamento não disponível.';
        const statusMap = {
            'pending': '⏳ Pendente',
            'paid': '✅ Pago',
            'canceled': '❌ Cancelado',
            'refunded': '↩️ Reembolsado'
        };
        return `*Status do Pagamento:* ${statusMap[paymentStatus] || paymentStatus}`;
    }

    formatOrderFinancialStatusResponse(financialStatus) {
        if (!financialStatus) return 'Status financeiro não disponível.';
        const statusMap = {
            'pending': '⏳ Pendente',
            'authorized': '✅ Autorizado',
            'paid': '✅ Pago',
            'voided': '❌ Cancelado',
            'refunded': '↩️ Reembolsado',
            'charged_back': '⚠️ Contestado'
        };
        return `*Status Financeiro:* ${statusMap[financialStatus] || financialStatus}`;
    }

    formatOrderShippingAddressResponse(shippingAddress) {
        if (!shippingAddress) return 'Endereço de entrega não disponível.';
        
        return `*Endereço de Entrega:*\n` +
               `${shippingAddress.name}\n` +
               `${shippingAddress.address}, ${shippingAddress.number}\n` +
               `${shippingAddress.complement || ''}\n`.trim() + '\n' +
               `${shippingAddress.neighborhood}\n` +
               `${shippingAddress.city} - ${shippingAddress.state}\n` +
               `CEP: ${shippingAddress.zipcode}`;
    }

    translateOrderStatus(status) {
        const statusMap = {
            'open': '🆕 Aberto',
            'closed': '✅ Concluído',
            'cancelled': '❌ Cancelado',
            'pending': '⏳ Pendente',
            'paid': '💰 Pago',
            'unpaid': '💳 Não Pago',
            'authorized': '✅ Autorizado',
            'in_progress': '🔄 Em Andamento',
            'in_separation': '📦 Em Separação',
            'ready_for_shipping': '📫 Pronto para Envio',
            'shipped': '🚚 Enviado',
            'delivered': '✅ Entregue',
            'unavailable': '❌ Indisponível'
        };
        return statusMap[status] || status;
    }

    formatOrderItems(items) {
        return items.map(item => 
            `• *${item.name}*\n` +
            `  Quantidade: ${item.quantity}\n` +
            `  Preço unitário: R$ ${(item.price / 100).toFixed(2)}\n` +
            `  Total: R$ ${(item.total / 100).toFixed(2)}`
        ).join('\n\n');
    }
}

// Exporta a classe AIServices da mesma forma que os outros serviços
module.exports = { AIServices };
