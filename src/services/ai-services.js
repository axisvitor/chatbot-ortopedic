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

            const isBusinessHours = this.businessHours.isWithinBusinessHours();

            if (!isBusinessHours) {
                console.log('⏰ Fora do horário comercial');
                const outOfHoursMessage = this.businessHours.getOutOfHoursMessage();
                await this.whatsAppService.sendText(message.from, outOfHoursMessage);
                return outOfHoursMessage;
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

            const redisKey = `chat:${message.from}`;
            console.log('🔄 Buscando histórico do chat no Redis:', redisKey);
            let chatHistory = await this.redisStore.get(redisKey) || [];

            console.log('💭 Histórico do chat recuperado:', {
                numeroMensagens: chatHistory.length,
                ultimaMensagem: chatHistory[chatHistory.length - 1]?.content?.substring(0, 100)
            });

            const userMessage = { role: 'user', content: message.text };
            chatHistory.push(userMessage);

            console.log('🤔 Gerando resposta com IA...');
            const aiResponse = await this.openAIService.generateResponse(chatHistory);
            console.log('✅ Resposta da IA gerada:', aiResponse?.substring(0, 100));

            const aiMessage = { role: 'assistant', content: aiResponse };
            chatHistory.push(aiMessage);

            console.log('💾 Salvando histórico atualizado no Redis...');
            await this.redisStore.set(redisKey, chatHistory);

            console.log('📤 Enviando resposta final...');
            return this.whatsAppService.sendText(message.from, aiResponse);
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            if (message && message.from) {
                return this.whatsAppService.sendText(message.from, 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.');
            }
            return null;
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
            return this.whatsAppService.sendText(from, response);
        } catch (error) {
            console.error('❌ Erro ao processar imagem:', error);
            return this.whatsAppService.sendText(from, 'Não foi possível processar sua imagem. Por favor, tente novamente ou envie uma mensagem de texto.');
        }
    }

    async handleAudioMessage(message) {
        const { from } = message;
        try {
            const response = await this.whatsAppService.processAudio(message);
            return this.whatsAppService.sendText(from, response);
        } catch (error) {
            console.error('❌ Erro ao processar áudio:', error);
            return this.whatsAppService.sendText(from, 'Não foi possível processar seu áudio. Por favor, tente novamente ou envie uma mensagem de texto.');
        }
    }
}

module.exports = { AIServices };
