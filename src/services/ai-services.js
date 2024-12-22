const { WhatsAppService } = require('./whatsapp-service');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { RedisStore } = require('../store/redis-store');
const { OpenAIService } = require('./openai-service');
const { TrackingService } = require('./tracking-service');
const { BusinessHoursService } = require('./business-hours');
const { OrderValidationService } = require('./order-validation-service');
const { NuvemshopService } = require('./nuvemshop-service');
const { GroqServices } = require('./groq-services');
const AudioService = require('./audio-service');

class AIServices {
    constructor(whatsAppService, whatsAppImageService, redisStore, openAIService, trackingService, orderValidationService, nuvemshopService) {
        this.whatsAppService = whatsAppService || new WhatsAppService();
        this.whatsAppImageService = whatsAppImageService || new WhatsAppImageService();
        this.redisStore = redisStore || new RedisStore();
        this.openAIService = openAIService || new OpenAIService();
        this.trackingService = trackingService || new TrackingService();
        this.orderValidationService = orderValidationService || new OrderValidationService();
        this.nuvemshopService = nuvemshopService || new NuvemshopService();
        this.businessHours = new BusinessHoursService();
        this.groqServices = new GroqServices();
        this.audioService = new AudioService(this.groqServices, this.whatsAppService);
    }

    async handleMessage(message) {
        try {
            if (!message) {
                throw new Error('Mensagem inválida');
            }

            const { type, from } = message;

            // Log da mensagem recebida
            console.log('📨 Mensagem recebida:', {
                tipo: type,
                de: from,
                messageId: message.messageId,
                timestamp: new Date().toISOString()
            });

            // Verifica se a mensagem já foi processada
            const processKey = `ai_processed:${message.messageId}`;
            const wasProcessed = await this.redisStore.get(processKey);
            
            if (wasProcessed) {
                console.log('⚠️ Mensagem já processada pelo AI:', {
                    messageId: message.messageId,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Marca a mensagem como processada antes de continuar
            await this.redisStore.set(processKey, 'true', 3600);

            // Verifica se é um comando especial
            if (message.text?.toLowerCase() === '#resetid') {
                const response = await this.handleResetCommand(message);
                await this.sendResponse(from, response);
                return;
            }

            // Verifica se é uma solicitação de atendimento humano
            if (message.text?.toLowerCase().includes('atendente') || 
                message.text?.toLowerCase().includes('humano') || 
                message.text?.toLowerCase().includes('pessoa')) {
                
                const isBusinessHours = this.businessHours.isWithinBusinessHours();
                if (!isBusinessHours) {
                    console.log('⏰ Fora do horário comercial para atendimento humano');
                    const response = this.businessHours.getOutOfHoursMessage();
                    await this.sendResponse(from, response);
                    return;
                }
            }

            // Verifica internamente se o pedido é internacional
            if (message.text?.toLowerCase().includes('pedido') || message.text?.toLowerCase().includes('encomenda')) {
                console.log('🔍 Verificando se é pedido internacional...');
                const orderIdMatch = message.text.match(/\d+/);
                if (orderIdMatch) {
                    const orderId = orderIdMatch[0];
                    console.log('📦 Buscando informações do pedido:', orderId);
                    const order = await this.nuvemshopService.getOrder(orderId);
                    
                    // Se for pedido internacional, encaminha internamente para o financeiro
                    if (order && order.shipping_address && order.shipping_address.country !== 'BR') {
                        console.log('🌍 Pedido internacional detectado:', orderId);
                        await this.whatsAppService.forwardToFinancial(message, orderId);
                        return;
                    }
                }
            }

            // Processa a mensagem com base no tipo
            let response;
            if (type === 'image') {
                response = await this.handleImageMessage(message);
            } else if (type === 'audio') {
                response = await this.handleAudioMessage(message);
            } else {
                // Busca histórico do chat no Redis
                const chatKey = `chat:${from}`;
                const chatHistory = await this.redisStore.get(chatKey);
                console.log('🔄 Buscando histórico do chat:', {
                    key: chatKey,
                    numeroMensagens: chatHistory?.messages?.length || 0,
                    ultimaMensagem: chatHistory?.messages?.[0]?.content
                });

                // Cria um novo thread ou usa o existente
                const threadId = chatHistory?.threadId || (await this.openAIService.createThread()).id;
                
                // Adiciona a mensagem ao thread
                await this.openAIService.addMessage(threadId, {
                    role: 'user',
                    content: message.text || 'Mensagem sem texto'
                });
                
                // Executa o assistant
                const run = await this.openAIService.runAssistant(threadId);
                
                // Aguarda a resposta
                response = await this.openAIService.waitForResponse(threadId, run.id);
                
                // Salva o histórico atualizado
                await this.redisStore.set(chatKey, {
                    threadId,
                    lastUpdate: new Date().toISOString()
                });
            }

            // Se não houver resposta, loga e retorna
            if (!response) {
                console.log('⚠️ Nenhuma resposta gerada');
                return null;
            }

            // Envia a resposta
            return await this.sendResponse(from, response);

        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            // Tenta enviar mensagem de erro
            if (message && message.from) {
                await this.sendResponse(
                    message.from,
                    'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.'
                );
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

            console.log('📤 Enviando resposta final...', {
                para: to,
                resposta: typeof response === 'string' ? response.substring(0, 100) : 'Objeto de resposta',
                timestamp: new Date().toISOString()
            });

            // Se a resposta for um objeto, tenta extrair a mensagem
            let messageText = response;
            if (typeof response === 'object' && response !== null) {
                messageText = response.message || response.text || JSON.stringify(response);
            }

            // Garante que a mensagem é uma string
            messageText = String(messageText);

            const result = await this.whatsAppService.sendText(to, messageText);

            if (!result) {
                throw new Error('Resposta do WhatsApp inválida');
            }

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
            const threadKey = `thread:${message.from}`;
            const currentThreadId = await this.redisStore.get(threadKey);
            
            // Se existir um thread antigo, tenta deletá-lo
            if (currentThreadId) {
                await this.openAIService.deleteThread(currentThreadId);
            }
            
            // Cria um novo thread
            const newThread = await this.openAIService.createThread();
            
            // Salva o novo threadId no Redis
            await this.redisStore.set(threadKey, newThread.id);
            
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

    async handleImageMessage(message) {
        const { from } = message;
        try {
            const response = await this.whatsAppImageService.processImage(message);
            return await this.handleResponse(message, response);
        } catch (error) {
            console.error('❌ Erro ao processar imagem:', error);
            const errorMessage = 'Não foi possível processar sua imagem. Por favor, tente novamente ou envie uma mensagem de texto.';
            return await this.handleResponse(message, errorMessage);
        }
    }

    async handleAudioMessage(message) {
        try {
            // Validação completa da mensagem
            if (!message) {
                throw new Error('Objeto de mensagem inválido');
            }

            const { from, type, messageId } = message;

            // Log detalhado da mensagem recebida
            console.log('🎤 Mensagem de áudio recebida:', {
                messageId,
                from,
                type,
                hasMediaUrl: !!message.mediaUrl,
                hasAudioMessage: !!message.audioMessage,
                timestamp: new Date().toISOString()
            });

            // Tenta obter a URL do áudio de diferentes propriedades possíveis
            const mediaUrl = message.mediaUrl || 
                           (message.audioMessage && message.audioMessage.url) ||
                           (message.audio && message.audio.url);

            if (!mediaUrl) {
                console.error('❌ URL do áudio não encontrada:', {
                    messageId,
                    from,
                    messageKeys: Object.keys(message),
                    timestamp: new Date().toISOString()
                });
                throw new Error('URL do áudio não encontrada na mensagem');
            }

            // Processa o áudio com a URL encontrada
            const audioMessage = {
                ...message,
                mediaUrl,
                messageId: messageId || `audio_${Date.now()}`
            };

            console.log('🎯 Processando áudio:', {
                messageId: audioMessage.messageId,
                mediaUrl: mediaUrl.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            // Processa o áudio e obtém a transcrição
            const audioText = await this.audioService.processWhatsAppAudio(audioMessage);
            
            if (!audioText || typeof audioText !== 'string') {
                console.error('❌ Transcrição inválida:', {
                    messageId,
                    transcriptionType: typeof audioText,
                    timestamp: new Date().toISOString()
                });
                throw new Error('Transcrição do áudio inválida');
            }

            console.log('📝 Áudio transcrito:', {
                messageId,
                transcriptionLength: audioText.length,
                preview: audioText.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            // Gera resposta baseada na transcrição
            const response = await this.openAIService.generateResponse({
                ...message,
                text: audioText
            });

            if (!response) {
                throw new Error('Resposta do OpenAI inválida');
            }

            // Formata e envia a resposta
            const formattedResponse = `🎵 *Mensagem de voz:*\n${audioText}\n\n${response}`;
            
            console.log('📤 Enviando resposta:', {
                messageId,
                from,
                responseLength: formattedResponse.length,
                preview: formattedResponse.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            return await this.sendResponse(from, formattedResponse);

        } catch (error) {
            // Log detalhado do erro
            console.error('❌ Erro ao processar áudio:', {
                erro: error.message,
                stack: error.stack,
                messageId: message?.messageId,
                from: message?.from,
                timestamp: new Date().toISOString()
            });
            
            // Envia mensagem de erro amigável
            if (message && message.from) {
                await this.sendResponse(
                    message.from, 
                    'Desculpe, não consegui processar seu áudio. Por favor, tente novamente ou envie uma mensagem de texto.'
                );
            }
            
            return null;
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

module.exports = { AIServices };
