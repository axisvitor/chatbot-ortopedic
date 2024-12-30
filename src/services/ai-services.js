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
    constructor(whatsAppService, whatsAppImageService, redisStore, openAIService, trackingService, orderValidationService, nuvemshopService) {
        this.whatsAppService = whatsAppService || new WhatsAppService();
        this.whatsAppImageService = whatsAppImageService || new WhatsAppImageService(this.whatsAppService, new GroqServices());
        this.redisStore = redisStore || new RedisStore();
        this.openAIService = openAIService || new OpenAIService();
        this.trackingService = trackingService || new TrackingService();
        this.orderValidationService = orderValidationService || new OrderValidationService();
        this.nuvemshopService = nuvemshopService || new NuvemshopService();
        this.businessHours = new BusinessHoursService();
        this.groqServices = new GroqServices();
        this.audioService = new AudioService(this.groqServices, this.whatsAppService);
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

            // Se for uma imagem, tenta extrair o número do pedido
            if (type === 'image' && imageUrl) {
                try {
                    const orderNumber = await this.orderValidationService.extractOrderNumber(imageUrl);
                    if (orderNumber) {
                        console.log(`🔍 Número do pedido encontrado na imagem: ${orderNumber}`);
                        const orderInfo = await this.orderValidationService.findOrder(orderNumber);
                        
                        if (orderInfo) {
                            await this.handleOrderInfo(from, orderInfo);
                            return;
                        } else {
                            await this.whatsappService.sendText(
                                from,
                                'Não encontrei nenhum pedido com esse número. Por favor, verifique se o número está correto e tente novamente.'
                            );
                            return;
                        }
                    }
                } catch (error) {
                    console.error('[AI] Erro ao processar imagem:', error);
                }
            }

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

            // Marca a mensagem como processada antes de continuar
            await this.redisStore.set(processKey, 'true');

            // Se for mensagem de áudio, processa com Whisper
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

                    // Atualiza o histórico com a transcrição e resposta
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
                    console.log('💾 Salvando histórico de áudio:', {
                        key: `chat:${from}`,
                        threadId: chatHistory.threadId,
                        mensagens: chatHistory.messages.length,
                        timestamp: new Date().toISOString()
                    });
                    await this.redisStore.set(`chat:${from}`, JSON.stringify(chatHistory));

                    // Log da resposta
                    console.log('📤 Enviando resposta para áudio:', {
                        messageId: messageData.messageId,
                        from: messageData.from,
                        threadId: chatHistory.threadId,
                        transcriptionLength: transcription.length,
                        responseLength: response.length,
                        preview: response.substring(0, 100),
                        timestamp: new Date().toISOString()
                    });

                    await this.sendResponse(from, response);
                }
                return null;
            }

            // Se for imagem, processa primeiro
            if (type === 'image') {
                console.log('🖼️ Processando imagem...');
                await this.handleImageMessage(messageData);
                return null;
            }

            // Verifica se é um comando especial
            if (text?.toLowerCase() === '#resetid') {
                const response = await this.handleResetCommand(messageData);
                await this.sendResponse(from, response);
                return null;
            }

            // Verifica se é uma solicitação de atendimento humano
            if (text?.toLowerCase().includes('atendente') || 
                text?.toLowerCase().includes('humano') || 
                text?.toLowerCase().includes('pessoa')) {
                
                const isBusinessHours = this.businessHours.isWithinBusinessHours();
                if (!isBusinessHours) {
                    console.log('⏰ Fora do horário comercial para atendimento humano');
                    const response = this.businessHours.getOutOfHoursMessage();
                    await this.sendResponse(from, response);
                    return null;
                }
            }

            // Verifica se é uma solicitação de rastreamento
            if (text?.toLowerCase().includes('rastrear') || 
                text?.toLowerCase().includes('status da entrega') ||
                text?.toLowerCase().includes('status do pedido')) {
                
                console.log('🔍 Solicitação de rastreamento detectada');

                // Primeiro tenta recuperar código de rastreio do cache
                const trackingKey = `tracking:${from}`;
                const trackingNumber = await this.redisStore.get(trackingKey);

                if (trackingNumber) {
                    console.log('📦 Código de rastreio encontrado:', {
                        codigo: trackingNumber,
                        de: from,
                        timestamp: new Date().toISOString()
                    });

                    // Busca status atual no 17track
                    const trackingStatus = await this.orderValidationService.getTrackingStatus(trackingNumber);
                    if (trackingStatus) {
                        await this.sendResponse(from, trackingStatus);
                        return null;
                    }
                }

                // Se não encontrou código de rastreio, verifica pedido em cache
                const orderKey = `order:${from}`;
                const orderNumber = await this.redisStore.get(orderKey);

                if (orderNumber) {
                    console.log('🔍 Pedido encontrado em cache:', {
                        numero: orderNumber,
                        de: from,
                        timestamp: new Date().toISOString()
                    });

                    const order = await this.orderValidationService.validateOrderNumber(orderNumber);
                    if (order) {
                        const orderResponse = await this.orderValidationService.formatOrderMessage(order, from);
                        if (orderResponse) {
                            await this.sendResponse(from, orderResponse);
                            return null;
                        }
                    }
                }

                await this.sendResponse(from, 'Por favor, me informe o número do seu pedido para que eu possa verificar o status de entrega.');
                return null;
            }

            // Verifica se é um número de pedido
            const orderNumber = this.orderValidationService.extractOrderNumber(text);
            if (orderNumber) {
                console.log('🔍 Buscando pedido:', {
                    numero: orderNumber,
                    textoOriginal: text,
                    de: from,
                    timestamp: new Date().toISOString()
                });

                // Verifica tentativas de validação
                const isBlocked = await this.orderValidationService.checkAttempts(from);
                if (isBlocked) {
                    console.log('🚫 Usuário bloqueado por muitas tentativas:', {
                        numero: from,
                        timestamp: new Date().toISOString()
                    });
                    await this.sendResponse(from, 'Você excedeu o número máximo de tentativas. Por favor, aguarde alguns minutos antes de tentar novamente.');
                    return null;
                }

                const order = await this.orderValidationService.validateOrderNumber(orderNumber);
                if (order) {
                    // Reseta tentativas em caso de sucesso
                    await this.orderValidationService.resetAttempts(from);

                    const response = await this.orderValidationService.formatOrderMessage(order, from);
                    await this.sendResponse(from, response);
                    return null;
                }

                // Incrementa tentativas em caso de falha
                await this.orderValidationService.incrementAttempts(from);
                await this.sendResponse(from, "Desculpe, não encontrei nenhum pedido com esse número. Por favor, verifique se o número está correto e tente novamente.");
                return null;
            }

            // Verifica se é uma pergunta sobre pedido ou se é pedido internacional
            if (text?.toLowerCase().includes('pedido') || 
                text?.toLowerCase().includes('encomenda') ||
                text?.toLowerCase().includes('compra')) {
                
                // Primeiro verifica se tem número de pedido na mensagem
                const orderIdMatch = text.match(/\d+/);
                if (orderIdMatch) {
                    const orderId = orderIdMatch[0];
                    console.log('📦 Buscando informações do pedido:', orderId);
                    const order = await this.nuvemshopService.getOrder(orderId);
                    
                    // Se for pedido internacional, encaminha para o financeiro
                    if (order && order.shipping_address && order.shipping_address.country !== 'BR') {
                        console.log('🌍 Pedido internacional detectado:', {
                            numero: orderId,
                            pais: order.shipping_address.country,
                            timestamp: new Date().toISOString()
                        });
                        await this.whatsAppService.forwardToFinancial(messageData, orderId);
                        return null;
                    }
                }

                // Se não for internacional, pede o número do pedido
                console.log('❓ Pergunta sobre pedido detectada:', {
                    texto: text,
                    de: from,
                    timestamp: new Date().toISOString()
                });

                await this.sendResponse(from, 'Por favor, me informe o número do seu pedido para que eu possa verificar o status.');
                return null;
            }

            // Verifica se é um possível código de rastreio
            const hasTrackingKeywords = this.trackingService.hasTrackingKeywords(text);
            const trackingNumber = this.trackingService.validateTrackingNumber(text);
            
            if (trackingNumber || (hasTrackingKeywords && text.length > 8)) {
                console.log('📦 Possível código de rastreio detectado:', {
                    texto: text,
                    codigo: trackingNumber,
                    temPalavrasChave: hasTrackingKeywords,
                    timestamp: new Date().toISOString()
                });

                // Verifica se tem pedido pendente
                const orderKey = `pending_order:${from}`;
                const pendingOrder = await this.redisStore.get(orderKey);

                if (pendingOrder) {
                    console.log('📦 Pedido pendente encontrado:', {
                        numero: pendingOrder,
                        de: from,
                        timestamp: new Date().toISOString()
                    });

                    const order = await this.orderValidationService.validateOrderNumber(pendingOrder);
                    if (order) {
                        const orderResponse = await this.orderValidationService.formatOrderMessage(order);
                        await this.sendResponse(from, orderResponse);
                        return null;
                    }
                }

                // Se for um código válido, busca direto
                if (trackingNumber) {
                    const trackingInfo = await this.trackingService.getTrackingStatus(trackingNumber);
                    if (trackingInfo) {
                        // Armazena para consultas futuras
                        const trackingKey = `tracking:${from}`;
                        await this.redisStore.set(trackingKey, trackingNumber);
                        
                        const response = this.formatOrderTrackingResponse(trackingInfo);
                        await this.sendResponse(from, response);
                        return null;
                    }
                }
                
                // Se tiver palavras-chave mas não for código válido
                if (hasTrackingKeywords) {
                    const trackingKey = `tracking:${from}`;
                    const savedTracking = await this.redisStore.get(trackingKey);
                    
                    if (savedTracking) {
                        const trackingInfo = await this.trackingService.getTrackingStatus(savedTracking);
                        if (trackingInfo) {
                            const response = this.formatOrderTrackingResponse(trackingInfo);
                            await this.sendResponse(from, response);
                            return null;
                        }
                    }
                }
            }

            // Verifica internamente se o pedido é internacional
            if (text?.toLowerCase().includes('pedido') || text?.toLowerCase().includes('encomenda')) {
                console.log('🔍 Verificando se é pedido internacional...');
                const orderIdMatch = text.match(/\d+/);
                if (orderIdMatch) {
                    const orderId = orderIdMatch[0];
                    console.log('📦 Buscando informações do pedido:', orderId);
                    const order = await this.nuvemshopService.getOrder(orderId);
                    
                    // Se for pedido internacional, encaminha internamente para o financeiro
                    if (order && order.shipping_address && order.shipping_address.country !== 'BR') {
                        console.log('🌍 Pedido internacional detectado:', orderId);
                        await this.whatsAppService.forwardToFinancial(messageData, orderId);
                        return null;
                    }
                }
            }

            // Verifica se está esperando número do pedido
            const waitingFor = await this.redisStore.get(`waiting_order:${messageData.from}`);
            if (waitingFor === 'payment_proof') {
                const orderNumber = this.extractOrderNumber(messageData.text);
                
                if (!orderNumber) {
                    await this.whatsAppService.sendMessage({
                        to: messageData.from,
                        body: `❌ Número do pedido inválido. Por favor, envie apenas o número do pedido (exemplo: 2913).`
                    });
                    return;
                }

                // Recupera o comprovante salvo
                const proofKey = `payment_proof:${messageData.from}`;
                const savedProof = await this.redisStore.get(proofKey);
                
                if (!savedProof) {
                    await this.whatsAppService.sendMessage({
                        to: messageData.from,
                        body: `❌ Desculpe, não encontrei mais o comprovante. Por favor, envie o comprovante novamente.`
                    });
                    return;
                }

                // Encaminha para o financeiro
                await this.whatsAppService.forwardToFinancial({
                    body: `💰 *Novo Comprovante de Pagamento*\n\n` +
                          `📦 Pedido: #${orderNumber}\n` +
                          `👤 Cliente: ${messageData.pushName || 'Não identificado'}\n` +
                          `📱 Telefone: ${messageData.from}\n\n` +
                          `🔍 Por favor, verifique o pagamento na conta.`,
                    image: savedProof
                }, orderNumber);

                // Limpa o cache
                await this.redisStore.del(proofKey);
                await this.redisStore.del(`waiting_order:${messageData.from}`);

                // Confirma para o cliente
                await this.whatsAppService.sendMessage({
                    to: messageData.from,
                    body: `✅ Comprovante encaminhado com sucesso para análise!\n\n` +
                          `O departamento financeiro irá verificar o pagamento e atualizar o status do seu pedido.`
                });

                return;
            }

            // Adiciona a mensagem ao thread
            console.log('💬 Adicionando mensagem:', {
                threadId: chatHistory.threadId,
                from,
                messageId: messageData.messageId,
                tipo: text ? 'texto' : messageData.audioMessage ? 'audio' : messageData.imageMessage ? 'imagem' : 'desconhecido',
                preview: text?.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            await this.openAIService.addMessage(chatHistory.threadId, {
                role: 'user',
                content: text || 'Mensagem sem texto'
            });

            // Executa o assistant
            const run = await this.openAIService.runAssistant(chatHistory.threadId);
            
            // Aguarda e obtém a resposta
            const response = await this.openAIService.waitForResponse(chatHistory.threadId, run.id);

            // Atualiza o histórico com a mensagem e resposta
            chatHistory.messages = chatHistory.messages || [];
            chatHistory.messages.unshift(
                {
                    role: 'user',
                    content: text || 'Mensagem sem texto',
                    type: 'text',
                    timestamp: new Date().toISOString()
                },
                {
                    role: 'assistant',
                    content: response,
                    timestamp: new Date().toISOString()
                }
            );
            
            chatHistory.lastUpdate = new Date().toISOString();
            console.log('💾 Salvando histórico:', {
                key: `chat:${from}`,
                threadId: chatHistory.threadId,
                mensagens: chatHistory.messages.length,
                ultimaMensagem: chatHistory.messages[0].content.substring(0, 100),
                timestamp: new Date().toISOString()
            });
            await this.redisStore.set(`chat:${from}`, JSON.stringify(chatHistory));

            console.log('🤖 Resposta do Assistant:', {
                threadId: chatHistory.threadId,
                runId: run.id,
                preview: response?.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            // Envia a resposta
            await this.sendResponse(from, response);
            return null;

        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
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
