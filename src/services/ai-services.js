const { WhatsAppService } = require('./whatsapp-service');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { RedisStore } = require('../store/redis-store');
const { OpenAIService } = require('./openai-service');
const { TrackingService } = require('./tracking-service');
const { BusinessHoursService } = require('./business-hours');
const { OrderValidationService } = require('./order-validation-service');
const { NuvemshopService } = require('./nuvemshop-service');

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
    }

    async handleMessage(message) {
        try {
            console.log('🤖 Iniciando processamento de mensagem:', {
                tipo: message.type,
                de: message.from,
                corpo: message.text?.substring(0, 100),
                messageId: message.messageId,
                timestamp: new Date().toISOString()
            });

            if (!message || !message.from) {
                console.error('❌ Mensagem inválida:', message);
                return;
            }

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

            let response;

            // Verifica se é um comando especial
            if (message.text?.toLowerCase() === '#resetid') {
                response = await this.handleResetCommand(message);
                await this.sendResponse(message.from, response);
                return;
            }

            // Verifica se é uma solicitação de atendimento humano
            if (message.text?.toLowerCase().includes('atendente') || 
                message.text?.toLowerCase().includes('humano') || 
                message.text?.toLowerCase().includes('pessoa')) {
                
                const isBusinessHours = this.businessHours.isWithinBusinessHours();
                if (!isBusinessHours) {
                    console.log('⏰ Fora do horário comercial para atendimento humano');
                    response = this.businessHours.getOutOfHoursMessage();
                    await this.sendResponse(message.from, response);
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
                    }
                }
            }

            if (message.type === 'image') {
                console.log('🖼️ Processando mensagem de imagem...');
                response = await this.handleImageMessage(message);
                await this.sendResponse(message.from, response);
                return;
            }

            if (message.type === 'audio') {
                console.log('🎵 Processando mensagem de áudio...');
                response = await this.handleAudioMessage(message);
                await this.sendResponse(message.from, response);
                return;
            }

            // Busca histórico do chat no Redis
            const chatKey = `chat:${message.from}`;
            const chatHistory = await this.redisStore.get(chatKey);
            console.log('🔄 Buscando histórico do chat no Redis:', chatKey);
            console.log('💭 Histórico do chat recuperado:', {
                numeroMensagens: chatHistory?.messages?.length || 0,
                ultimaMensagem: chatHistory?.messages?.[0]?.content
            });

            // Gera resposta com IA
            console.log('🤔 Gerando resposta com IA...');
            
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

            // Envia a resposta
            await this.sendResponse(message.from, response);
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            await this.sendResponse(message.from, 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.');
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

    async sendResponse(to, response) {
        try {
            // Se a resposta for um objeto, extrai apenas o texto
            const messageText = typeof response === 'object' ? 
                (response.message?.text || response.text || '') : 
                String(response);

            // Se a mensagem estiver vazia após a extração, não envia
            if (!messageText.trim()) {
                console.log('⚠️ Mensagem vazia, não será enviada');
                return null;
            }

            console.log('📤 Enviando resposta final...', {
                para: to,
                resposta: messageText?.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            const result = await this.whatsAppService.sendText(to, messageText);

            // Não retorna o resultado completo, apenas um indicador de sucesso
            return {
                success: !result.error,
                messageId: result.messageId
            };
        } catch (error) {
            console.error('❌ Erro ao enviar resposta:', {
                para: to,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    async handleResponse(message, response) {
        try {
            if (!response) {
                console.log('⚠️ Resposta vazia, não será enviada');
                return null;
            }

            console.log('📤 Resposta gerada com sucesso:', {
                para: message.from,
                resposta: typeof response === 'object' ? 'Objeto de resposta' : response?.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            // Envia a resposta
            return await this.sendResponse(message.from, response);
        } catch (error) {
            console.error('❌ Erro ao processar resposta:', error);
            throw error;
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
        const { from } = message;
        try {
            const response = await this.whatsAppService.processAudio(message);
            return await this.handleResponse(message, response);
        } catch (error) {
            console.error('❌ Erro ao processar áudio:', error);
            const errorMessage = 'Não foi possível processar seu áudio. Por favor, tente novamente ou envie uma mensagem de texto.';
            return await this.handleResponse(message, errorMessage);
        }
    }
}

module.exports = { AIServices };
