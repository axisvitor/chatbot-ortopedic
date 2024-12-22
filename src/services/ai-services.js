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
                timestamp: new Date().toISOString()
            });

            if (!message || !message.from) {
                console.error('❌ Mensagem inválida:', message);
                return null;
            }

            // Verifica se é uma solicitação de atendimento humano
            if (message.text?.toLowerCase().includes('atendente') || 
                message.text?.toLowerCase().includes('humano') || 
                message.text?.toLowerCase().includes('pessoa')) {
                
                const isBusinessHours = this.businessHours.isWithinBusinessHours();
                if (!isBusinessHours) {
                    console.log('⏰ Fora do horário comercial para atendimento humano');
                    const outOfHoursMessage = this.businessHours.getOutOfHoursMessage();
                    await this.whatsAppService.sendText(message.from, outOfHoursMessage);
                    return outOfHoursMessage;
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
                return this.handleImageMessage(message);
            }

            if (message.type === 'audio') {
                console.log('🎵 Processando mensagem de áudio...');
                return this.handleAudioMessage(message);
            }

            // Busca histórico do chat no Redis
            const chatKey = `chat:${message.from}`;
            console.log('🔄 Buscando histórico do chat no Redis:', chatKey);
            const chatHistory = await this.redisStore.get(chatKey);
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
            const response = await this.openAIService.waitForResponse(threadId, run.id);
            
            // Salva o histórico atualizado
            await this.redisStore.set(chatKey, {
                threadId,
                lastUpdate: new Date().toISOString()
            });

            console.log('📤 Enviando resposta final...');
            await this.whatsAppService.sendText(message.from, response);
            return response;
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            const errorMessage = 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.';
            await this.whatsAppService.sendText(message.from, errorMessage);
            return errorMessage;
        }
    }

    formatProductResponse(product) {
        return `
        **Produto:** ${product.name}
        **SKU:** ${product.sku}
        **Preço:** R$ ${product.price}
        **Descrição:** ${product.description}
        **Link:** ${product.url}
        `;
    }

    formatProductListResponse(products) {
        let response = "**Produtos Encontrados:**\n";
        products.forEach(product => {
            response += `- ${product.name} - R$ ${product.price}\n`;
        });
        return response;
    }

    formatOrderResponse(order) {
        return `
        **Pedido:** ${order.id}
        **Status:** ${order.status}
        **Total:** R$ ${order.total}
        **Frete:** R$ ${order.shipping_cost || 'Não disponível'}
        **Rastreamento:** ${order.shipping_address?.tracking_code || 'Não disponível'}
        `;
    }

    formatOrderTrackingResponse(trackingCode) {
        return `
        **Rastreamento do Pedido:** ${trackingCode}
        **Link:** https://www.17track.net/${trackingCode}
        `;
    }

    formatOrderTotalResponse(total) {
        return `**Total do Pedido:** R$ ${total}`;
    }

    formatOrderPaymentStatusResponse(paymentStatus) {
        return `**Status do Pagamento:** ${paymentStatus}`;
    }

    formatOrderFinancialStatusResponse(financialStatus) {
        return `**Status do Pedido:** ${financialStatus}`;
    }

    formatOrderShippingAddressResponse(shippingAddress) {
        return `
        **Endereço de Entrega:**
        ${shippingAddress.name}
        ${shippingAddress.address}
        ${shippingAddress.city}, ${shippingAddress.state} - ${shippingAddress.zipcode}
        `;
    }

    async handleImageMessage(message) {
        const { from } = message;
        try {
            const response = await this.whatsAppImageService.processImage(message);
            await this.whatsAppService.sendText(from, response);
            return response;
        } catch (error) {
            console.error('❌ Erro ao processar imagem:', error);
            const errorMessage = 'Não foi possível processar sua imagem. Por favor, tente novamente ou envie uma mensagem de texto.';
            await this.whatsAppService.sendText(from, errorMessage);
            return errorMessage;
        }
    }

    async handleAudioMessage(message) {
        const { from } = message;
        try {
            const response = await this.whatsAppService.processAudio(message);
            await this.whatsAppService.sendText(from, response);
            return response;
        } catch (error) {
            console.error('❌ Erro ao processar áudio:', error);
            const errorMessage = 'Não foi possível processar seu áudio. Por favor, tente novamente ou envie uma mensagem de texto.';
            await this.whatsAppService.sendText(from, errorMessage);
            return errorMessage;
        }
    }
}

module.exports = { AIServices };
