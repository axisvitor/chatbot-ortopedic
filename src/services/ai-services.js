const { WhatsAppService } = require('./whatsapp-service');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { RedisStore } = require('../store/redis-store');
const { OpenAIService } = require('./openai-service');
const { TrackingService } = require('./tracking-service');
const businessHours = require('./business-hours');
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
    }

    async handleMessage(message) {
        try {
            console.log('🤖 Iniciando processamento de mensagem:', {
                tipo: message.type,
                de: message.from,
                corpo: message.body?.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            const { body, from, type } = message;
            const isBusinessHours = businessHours.isBusinessHours();

            if (!isBusinessHours) {
                console.log('⏰ Fora do horário comercial');
                return this.whatsAppService.sendText(from, businessHours.getOutOfOfficeMessage());
            }

            // Verifica internamente se o pedido é internacional
            if (body.toLowerCase().includes('pedido') || body.toLowerCase().includes('encomenda')) {
                console.log('🔍 Verificando se é pedido internacional...');
                const orderIdMatch = body.match(/\d+/);
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

            if (type === 'image') {
                console.log('🖼️ Processando mensagem de imagem...');
                return this.handleImageMessage(message);
            }

            if (type === 'audio') {
                console.log('🎵 Processando mensagem de áudio...');
                return this.handleAudioMessage(message);
            }

            const redisKey = `chat:${from}`;
            console.log('🔄 Buscando histórico do chat no Redis:', redisKey);
            let chatHistory = await this.redisStore.get(redisKey) || [];

            console.log('💭 Histórico do chat recuperado:', {
                numeroMensagens: chatHistory.length,
                ultimaMensagem: chatHistory[chatHistory.length - 1]?.content?.substring(0, 100)
            });

            const userMessage = { role: 'user', content: body };
            chatHistory.push(userMessage);

            console.log('🤔 Gerando resposta com IA...');
            const aiResponse = await this.openAIService.generateResponse(chatHistory);
            console.log('✅ Resposta da IA gerada:', aiResponse?.substring(0, 100));

            const aiMessage = { role: 'assistant', content: aiResponse };
            chatHistory.push(aiMessage);

            console.log('💾 Salvando histórico atualizado no Redis...');
            await this.redisStore.set(redisKey, chatHistory);

            // Formatação das respostas da Nuvemshop
            if (aiResponse.includes('produto')) {
                console.log('🛍️ Processando resposta sobre produto...');
                const productIdMatch = aiResponse.match(/produto (\d+)/);
                if (productIdMatch) {
                    const productId = productIdMatch[1];
                    const product = await this.nuvemshopService.getProduct(productId);
                    if (product) {
                        const formattedResponse = this.formatProductResponse(product);
                        return this.whatsAppService.sendText(from, formattedResponse);
                    }
                }
                const skuMatch = aiResponse.match(/sku (\w+)/);
                if (skuMatch) {
                    const sku = skuMatch[1];
                    const product = await this.nuvemshopService.getProductBySku(sku);
                    if (product) {
                        const formattedResponse = this.formatProductResponse(product);
                        return this.whatsAppService.sendText(from, formattedResponse);
                    }
                }
                const searchMatch = aiResponse.match(/buscar produtos ([\w\s]+)/);
                if (searchMatch) {
                    const query = searchMatch[1];
                    const products = await this.nuvemshopService.searchProducts(query);
                    if (products && products.length > 0) {
                        const formattedResponse = this.formatProductListResponse(products);
                        return this.whatsAppService.sendText(from, formattedResponse);
                    }
                }
            }

            if (aiResponse.includes('pedido')) {
                console.log('📦 Processando resposta sobre pedido...');
                const orderIdMatch = aiResponse.match(/pedido (\d+)/);
                if (orderIdMatch) {
                    const orderId = orderIdMatch[1];
                    const order = await this.nuvemshopService.getOrder(orderId);
                    if (order) {
                        const formattedResponse = this.formatOrderResponse(order);
                        return this.whatsAppService.sendText(from, formattedResponse);
                    }
                }
                const trackingMatch = aiResponse.match(/rastreamento do pedido (\d+)/);
                if (trackingMatch) {
                    const orderId = trackingMatch[1];
                    const trackingCode = await this.nuvemshopService.getOrderTracking(orderId);
                    if (trackingCode) {
                        const formattedResponse = this.formatOrderTrackingResponse(trackingCode);
                        return this.whatsAppService.sendText(from, formattedResponse);
                    }
                }
                const totalMatch = aiResponse.match(/total do pedido (\d+)/);
                if (totalMatch) {
                    const orderId = totalMatch[1];
                    const total = await this.nuvemshopService.getOrderTotal(orderId);
                    if (total) {
                        const formattedResponse = this.formatOrderTotalResponse(total);
                        return this.whatsAppService.sendText(from, formattedResponse);
                    }
                }
                const paymentStatusMatch = aiResponse.match(/status de pagamento do pedido (\d+)/);
                if (paymentStatusMatch) {
                    const orderId = paymentStatusMatch[1];
                    const paymentStatus = await this.nuvemshopService.getOrderPaymentStatus(orderId);
                    if (paymentStatus) {
                        const formattedResponse = this.formatOrderPaymentStatusResponse(paymentStatus);
                        return this.whatsAppService.sendText(from, formattedResponse);
                    }
                }
                const financialStatusMatch = aiResponse.match(/status financeiro do pedido (\d+)/);
                if (financialStatusMatch) {
                    const orderId = financialStatusMatch[1];
                    const financialStatus = await this.nuvemshopService.getOrderFinancialStatus(orderId);
                    if (financialStatus) {
                        const formattedResponse = this.formatOrderFinancialStatusResponse(financialStatus);
                        return this.whatsAppService.sendText(from, formattedResponse);
                    }
                }
                const shippingAddressMatch = aiResponse.match(/endereço de entrega do pedido (\d+)/);
                if (shippingAddressMatch) {
                    const orderId = shippingAddressMatch[1];
                    const shippingAddress = await this.nuvemshopService.getOrderShippingAddress(orderId);
                    if (shippingAddress) {
                        const formattedResponse = this.formatOrderShippingAddressResponse(shippingAddress);
                        return this.whatsAppService.sendText(from, formattedResponse);
                    }
                }
            }

            console.log('📤 Enviando resposta final...');
            return this.whatsAppService.sendText(from, aiResponse);
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return this.whatsAppService.sendText(from, 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.');
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
