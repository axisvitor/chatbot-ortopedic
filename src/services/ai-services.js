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
        const { body, from, type } = message;
        const isBusinessHours = businessHours.isBusinessHours();

        if (!isBusinessHours) {
            return this.whatsAppService.sendMessage(from, businessHours.getOutOfOfficeMessage());
        }

        if (type === 'image') {
            return this.handleImageMessage(message);
        }

        if (type === 'audio') {
            return this.handleAudioMessage(message);
        }

        const redisKey = `chat:${from}`;
        let chatHistory = await this.redisStore.get(redisKey) || [];

        const userMessage = { role: 'user', content: body };
        chatHistory.push(userMessage);

        const aiResponse = await this.openAIService.generateResponse(chatHistory);
        const aiMessage = { role: 'assistant', content: aiResponse };
        chatHistory.push(aiMessage);

        await this.redisStore.set(redisKey, chatHistory);

        // Formatação das respostas da Nuvemshop
        if (aiResponse.includes('produto')) {
            const productIdMatch = aiResponse.match(/produto (\d+)/);
            if (productIdMatch) {
                const productId = productIdMatch[1];
                const product = await this.nuvemshopService.getProduct(productId);
                if (product) {
                    const formattedResponse = this.formatProductResponse(product);
                    return this.whatsAppService.sendMessage(from, formattedResponse);
                }
            }
            const skuMatch = aiResponse.match(/sku (\w+)/);
            if (skuMatch) {
                const sku = skuMatch[1];
                const product = await this.nuvemshopService.getProductBySku(sku);
                if (product) {
                    const formattedResponse = this.formatProductResponse(product);
                    return this.whatsAppService.sendMessage(from, formattedResponse);
                }
            }
            const searchMatch = aiResponse.match(/buscar produtos ([\w\s]+)/);
            if (searchMatch) {
                const query = searchMatch[1];
                const products = await this.nuvemshopService.searchProducts(query);
                if (products && products.length > 0) {
                    const formattedResponse = this.formatProductListResponse(products);
                    return this.whatsAppService.sendMessage(from, formattedResponse);
                }
            }
        }

        if (aiResponse.includes('pedido')) {
            const orderIdMatch = aiResponse.match(/pedido (\d+)/);
            if (orderIdMatch) {
                const orderId = orderIdMatch[1];
                const order = await this.nuvemshopService.getOrder(orderId);
                if (order) {
                    const formattedResponse = this.formatOrderResponse(order);
                    return this.whatsAppService.sendMessage(from, formattedResponse);
                }
            }
            const trackingMatch = aiResponse.match(/rastreamento do pedido (\d+)/);
            if (trackingMatch) {
                const orderId = trackingMatch[1];
                const trackingCode = await this.nuvemshopService.getOrderTracking(orderId);
                if (trackingCode) {
                    const formattedResponse = this.formatOrderTrackingResponse(trackingCode);
                    return this.whatsAppService.sendMessage(from, formattedResponse);
                }
            }
            const totalMatch = aiResponse.match(/total do pedido (\d+)/);
            if (totalMatch) {
                const orderId = totalMatch[1];
                const total = await this.nuvemshopService.getOrderTotal(orderId);
                if (total) {
                    const formattedResponse = this.formatOrderTotalResponse(total);
                    return this.whatsAppService.sendMessage(from, formattedResponse);
                }
            }
            const paymentStatusMatch = aiResponse.match(/status de pagamento do pedido (\d+)/);
            if (paymentStatusMatch) {
                const orderId = paymentStatusMatch[1];
                const paymentStatus = await this.nuvemshopService.getOrderPaymentStatus(orderId);
                if (paymentStatus) {
                    const formattedResponse = this.formatOrderPaymentStatusResponse(paymentStatus);
                    return this.whatsAppService.sendMessage(from, formattedResponse);
                }
            }
            const financialStatusMatch = aiResponse.match(/status financeiro do pedido (\d+)/);
            if (financialStatusMatch) {
                const orderId = financialStatusMatch[1];
                const financialStatus = await this.nuvemshopService.getOrderFinancialStatus(orderId);
                if (financialStatus) {
                    const formattedResponse = this.formatOrderFinancialStatusResponse(financialStatus);
                    return this.whatsAppService.sendMessage(from, formattedResponse);
                }
            }
            const shippingAddressMatch = aiResponse.match(/endereço de entrega do pedido (\d+)/);
            if (shippingAddressMatch) {
                const orderId = shippingAddressMatch[1];
                const shippingAddress = await this.nuvemshopService.getOrderShippingAddress(orderId);
                if (shippingAddress) {
                    const formattedResponse = this.formatOrderShippingAddressResponse(shippingAddress);
                    return this.whatsAppService.sendMessage(from, formattedResponse);
                }
            }
        }

        return this.whatsAppService.sendMessage(from, aiResponse);
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
        **Rastreamento:** ${order.shipping_address?.tracking_code || 'Não disponível'}
        **Link:** ${order.url}
        `;
    }

    formatOrderTrackingResponse(trackingCode) {
        return `
        **Rastreamento do Pedido:** ${trackingCode}
        **Link:** https://www.link-para-rastreamento.com/${trackingCode}
        `;
    }

    formatOrderTotalResponse(total) {
        return `
        **Total do Pedido:** R$ ${total}
        `;
    }

    formatOrderPaymentStatusResponse(paymentStatus) {
        return `
        **Status de Pagamento do Pedido:** ${paymentStatus}
        `;
    }

    formatOrderFinancialStatusResponse(financialStatus) {
        return `
        **Status Financeiro do Pedido:** ${financialStatus}
        `;
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
            return this.whatsAppService.sendMessage(from, response);
        } catch (error) {
            console.error('❌ Erro ao processar imagem:', error);
            return this.whatsAppService.sendMessage(from, 'Não foi possível processar sua imagem. Por favor, tente novamente ou envie uma mensagem de texto.');
        }
    }

    async handleAudioMessage(message) {
        const { from } = message;
        try {
            const response = await this.whatsAppService.processAudio(message);
            return this.whatsAppService.sendMessage(from, response);
        } catch (error) {
            console.error('❌ Erro ao processar áudio:', error);
            return this.whatsAppService.sendMessage(from, 'Não foi possível processar seu áudio. Por favor, tente novamente ou envie uma mensagem de texto.');
        }
    }
}

module.exports = { AIServices };
