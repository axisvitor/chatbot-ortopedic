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
const { ImageService } = require('./image-service');

class AIServices {
    constructor(whatsAppService, whatsAppImageService, redisStore, openAIService, trackingService, orderValidationService, nuvemshopService, businessHoursService) {
        this.whatsAppService = whatsAppService || new WhatsAppService();
        this.whatsAppImageService = whatsAppImageService || new WhatsAppImageService(this.whatsAppService, new GroqServices());
        this.redisStore = redisStore || new RedisStore();
        this.openAIService = openAIService || new OpenAIService();
        this.trackingService = trackingService || new TrackingService();
        this.orderValidationService = orderValidationService || new OrderValidationService();
        this.nuvemshopService = nuvemshopService || new NuvemshopService();
        this.businessHoursService = businessHoursService || new BusinessHoursService();
        this.audioService = new AudioService();
        this.groqServices = new GroqServices();
        this.imageService = new ImageService(this.groqServices, this.whatsAppService);
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
            console.log('📨 Processando mensagem:', {
                tipo: messageData.type,
                conteudo: JSON.stringify(messageData.message, null, 2)
            });

            // Extrai informações da mensagem
            const message = messageData.message;
            const from = messageData.key?.remoteJid;

            if (!from) {
                throw new Error('Remetente não encontrado na mensagem');
            }

            // Verifica se é uma mensagem de imagem
            if (message?.imageMessage || (messageData.mediaMessage?.images?.length > 0)) {
                console.log('🖼️ Mensagem de imagem detectada');
                
                // Coleta todas as imagens da mensagem
                const imageMessages = [];
                
                if (message?.imageMessage) {
                    imageMessages.push(message.imageMessage);
                }

                if (messageData.mediaMessage?.images) {
                    imageMessages.push(...messageData.mediaMessage.images);
                }

                if (imageMessages.length === 0) {
                    throw new Error('Nenhuma imagem encontrada na mensagem');
                }

                console.log(`📸 Encontradas ${imageMessages.length} imagem(s) para processar:`, 
                    JSON.stringify(imageMessages, null, 2)
                );

                // Processa todas as imagens
                const paymentInfos = await this.whatsappImageService.processPaymentProof(imageMessages);

                // Prepara o contexto com as informações de todas as imagens
                const context = {
                    messageType: 'image',
                    imageAnalysis: Array.isArray(paymentInfos) ? paymentInfos : [paymentInfos]
                };

                // Gera resposta baseada na análise
                const response = await this.generateResponse(from, '', context);
                
                // Envia a resposta
                await this.sendResponse(from, response);
                
                return;
            }

            // Para mensagens de texto
            if (messageData.type === 'text' && message.text) {
                console.log(`[AIServices] Processando mensagem de texto: ${message.text.substring(0, 100)}...`);
                
                const response = await this.generateResponse(from, message.text);
                
                if (response) {
                    console.log(`[AIServices] Enviando resposta para ${from}`);
                    await this.whatsAppService.sendText(from, response);
                } else {
                    console.warn(`[AIServices] Resposta vazia para ${from}`);
                    await this.whatsAppService.sendText(
                        from,
                        'Desculpe, não consegui processar sua mensagem no momento. Por favor, tente novamente.'
                    );
                }
                return;
            }

            // Para outros tipos de mensagem
            console.warn(`[AIServices] Tipo de mensagem não suportado: ${messageData.type}`);
            await this.whatsAppService.sendText(
                from,
                'Desculpe, este tipo de mensagem não é suportado no momento.'
            );

        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
            
            // Envia mensagem de erro para o usuário
            try {
                await this.whatsAppService.sendText(
                    messageData.from,
                    'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes.'
                );
            } catch (sendError) {
                console.error('❌ Erro ao enviar mensagem de erro:', sendError);
            }
        }
    }

    async generateResponse(from, message, context = null) {
        try {
            console.log(`[AIServices] Gerando resposta para ${from}:`, {
                mensagem: message,
                contexto: context
            });
            
            // Recupera ou cria histórico do chat
            const chatHistory = await this.getChatHistory(from);
            console.log(`[AIServices] Chat history recuperado para ${from}:`, chatHistory);

            if (!chatHistory || !chatHistory.threadId) {
                throw new Error('Thread ID não encontrado no histórico do chat');
            }

            // Prepara o conteúdo da mensagem
            let messageContent = [];

            // Adiciona o texto da mensagem se existir
            if (message) {
                messageContent.push({
                    type: 'text',
                    text: message
                });
            }

            // Adiciona imagens se existirem no contexto
            if (context?.messageType === 'image' && context.imageAnalysis) {
                messageContent.push({
                    type: 'text',
                    text: `Análise das imagens:\n${JSON.stringify(context.imageAnalysis, null, 2)}`
                });
            }

            // Se não houver conteúdo, usa uma string vazia
            if (messageContent.length === 0) {
                messageContent = [{ type: 'text', text: '' }];
            }

            // Adiciona mensagem do usuário ao thread e gera resposta
            const response = await this.openAIService.addMessageAndRun(chatHistory.threadId, {
                role: 'user',
                content: messageContent
            });

            if (!response) {
                console.warn(`[AIServices] Resposta vazia recebida para ${from}`);
                return "Desculpe, não consegui processar sua mensagem no momento. Por favor, tente novamente.";
            }

            // Atualiza histórico com a nova resposta
            await this.redisStore.set(`chat:${from}`, JSON.stringify(chatHistory));
            console.log(`[AIServices] Resposta gerada com sucesso para ${from}`);

            return response;
        } catch (error) {
            console.error('[AIServices] Erro ao gerar resposta:', error);
            return "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes.";
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

    async handleImageMessage(message) {
        try {
            const { de: from } = message;
            console.log('📨 Processando mensagem de imagem:', { de: from });

            // Obtém o histórico do chat
            const chatHistory = await this.getChatHistory(from);

            // Baixa a imagem
            const imageBuffer = await this.whatsAppImageService.downloadImage(message);
            if (!imageBuffer) {
                throw new Error('Não foi possível baixar a imagem');
            }

            // Converte para base64
            const base64Image = imageBuffer.toString('base64');

            // Analisa a imagem com Groq Vision
            const imageAnalysis = await this.analyzeImageWithGroq(base64Image);
            console.log('📝 Análise da imagem:', imageAnalysis);

            if (!imageAnalysis) {
                throw new Error('Não foi possível analisar a imagem');
            }

            // Envia a análise para o OpenAI Assistant
            const response = await this.openAIService.addMessageAndRun(chatHistory.threadId, {
                role: 'user',
                content: imageAnalysis
            });

            if (response) {
                await this.sendResponse(from, response);
            }

        } catch (error) {
            console.error('❌ Erro ao processar imagem:', error);
            await this.sendResponse(from, 'Desculpe, não consegui processar sua imagem. Por favor, tente enviar novamente ou envie uma mensagem de texto.');
        }
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

    async analyzeImageWithGroq(imageBuffer) {
        try {
            const analysis = await this.whatsAppImageService.analyzeImage(imageBuffer);
            return analysis;
        } catch (error) {
            console.error('❌ Erro ao analisar imagem com Groq:', error);
            throw new Error('Não foi possível analisar a imagem com Groq Vision');
        }
    }

    async extractPaymentInfo(analysis) {
        try {
            // Extrai informações relevantes do texto da análise
            const info = {
                valor: this.extractValue(analysis),
                data: this.extractDate(analysis),
                tipoTransacao: this.extractTransactionType(analysis),
                bancoOrigem: this.extractBank(analysis),
                status: this.extractStatus(analysis)
            };

            return info;
        } catch (error) {
            console.error('❌ Erro ao extrair informações do pagamento:', error);
            throw new Error('Não foi possível extrair as informações do comprovante');
        }
    }

    extractValue(text) {
        const valueMatch = text.match(/R\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)/);
        return valueMatch ? valueMatch[0] : null;
    }

    extractDate(text) {
        const dateMatch = text.match(/\d{2}\/\d{2}\/\d{4}/);
        return dateMatch ? dateMatch[0] : null;
    }

    extractTransactionType(text) {
        const types = ['PIX', 'TED', 'DOC', 'Transferência'];
        for (const type of types) {
            if (text.includes(type)) return type;
        }
        return null;
    }

    extractBank(text) {
        const bankMatch = text.match(/(?:Banco|BANCO)\s+([^\n.,]+)/);
        return bankMatch ? bankMatch[1].trim() : null;
    }

    extractStatus(text) {
        const statusMatch = text.match(/(?:Status|STATUS):\s*([^\n.,]+)/);
        return statusMatch ? statusMatch[1].trim() : 'Não identificado';
    }
}

// Exporta a classe AIServices da mesma forma que os outros serviços
module.exports = { AIServices };
