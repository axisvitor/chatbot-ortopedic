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

            const { type, from, text } = message;

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
                return null;
            }

            // Marca a mensagem como processada antes de continuar
            await this.redisStore.set(processKey, 'true', 3600);

            // Verifica se é um comando especial
            if (text?.toLowerCase() === '#resetid') {
                const response = await this.handleResetCommand(message);
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

            // Verifica se é um número de pedido
            if (text && /^\d{4,}$/.test(text.trim())) {
                const orderNumber = text.trim();
                console.log('🔍 Buscando pedido:', {
                    numero: orderNumber,
                    de: from,
                    timestamp: new Date().toISOString()
                });

                const order = await this.orderValidationService.validateOrderNumber(orderNumber);
                if (order) {
                    // Armazena o número do pedido temporariamente para contexto
                    const orderKey = `pending_order:${from}`;
                    await this.redisStore.set(orderKey, orderNumber, 300); // 5 minutos de TTL
                    
                    const response = this.orderValidationService.formatOrderMessage(order);
                    await this.sendResponse(from, response);
                    
                    // Log do pedido armazenado
                    console.log('💾 Pedido armazenado temporariamente:', {
                        numero: orderNumber,
                        de: from,
                        chave: orderKey,
                        ttl: '5 minutos',
                        timestamp: new Date().toISOString()
                    });
                    
                    return null;
                } else {
                    await this.sendResponse(from, "Desculpe, não encontrei nenhum pedido com esse número. Por favor, verifique se o número está correto e tente novamente.");
                    return null;
                }
            }

            // Verifica se há um pedido pendente para o usuário
            const orderKey = `pending_order:${from}`;
            const pendingOrder = await this.redisStore.get(orderKey);
            if (pendingOrder) {
                console.log('📦 Pedido pendente encontrado:', {
                    numero: pendingOrder,
                    de: from,
                    timestamp: new Date().toISOString()
                });
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
                        await this.whatsAppService.forwardToFinancial(message, orderId);
                        return null;
                    }
                }
            }

            // Processa a mensagem com base no tipo
            let response;
            if (type === 'image') {
                response = await this.handleImageMessage(message);
            } else if (type === 'audio') {
                const transcription = await this.handleAudioMessage(message);
                if (transcription) {
                    // Adiciona a transcrição ao thread do OpenAI
                    const threadId = await this.openAIService.createThread();
                    await this.openAIService.addMessage(threadId, {
                        role: 'user',
                        content: transcription
                    });
                    
                    // Executa o assistant e aguarda resposta
                    const run = await this.openAIService.runAssistant(threadId);
                    response = await this.openAIService.waitForResponse(threadId, run.id);

                    // Log da resposta
                    console.log('📤 Enviando resposta para áudio:', {
                        messageId: message.messageId,
                        from: message.from,
                        transcriptionLength: transcription.length,
                        responseLength: response.length,
                        preview: response.substring(0, 100),
                        timestamp: new Date().toISOString()
                    });
                }
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

            // Se a resposta for um objeto de erro, envia apenas a mensagem
            if (typeof response === 'object' && response.error) {
                await this.sendResponse(from, response.message);
                return null;
            }

            // Envia a resposta
            await this.sendResponse(from, response);
            return null;

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

            // Se a resposta for um objeto, tenta extrair a mensagem
            let messageText = response;
            if (typeof response === 'object' && response !== null) {
                // Se for uma resposta da API, não enviar novamente
                if (response.success !== undefined && response.messageId) {
                    return response;
                }
                messageText = response.message || response.text || response.content || 'Erro: Resposta inválida';
            }

            // Garante que a mensagem é uma string
            messageText = String(messageText);

            console.log('📤 Enviando resposta:', {
                para: to,
                preview: messageText.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            // Envia a mensagem via WhatsApp
            const result = await this.whatsAppService.sendText(to, messageText);
            
            if (!result) {
                throw new Error('Erro ao enviar mensagem');
            }

            console.log('✅ Resposta enviada:', {
                resultado: result,
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

            console.log('🎯 Baixando imagem:', {
                messageId,
                mimetype: message.message.imageMessage.mimetype,
                timestamp: new Date().toISOString()
            });

            // Baixa a imagem usando o Baileys
            const buffer = await this.whatsAppService.downloadMediaMessage(message);

            // Valida o buffer da imagem
            if (!buffer || buffer.length < 100) {
                throw new Error('Buffer da imagem inválido ou muito pequeno');
            }

            console.log('✅ Imagem baixada:', {
                messageId,
                tamanho: buffer.length,
                tipo: message.message.imageMessage.mimetype,
                timestamp: new Date().toISOString()
            });

            // Analisa a imagem com o Groq
            const result = await this.groqServices.processImage(buffer, message);

            if (!result) {
                throw new Error('Análise da imagem falhou');
            }

            console.log('🔍 Análise da imagem:', {
                messageId,
                tipo: result.type,
                isPaymentProof: result.isPaymentProof,
                timestamp: new Date().toISOString()
            });

            // Se for um comprovante, pede informações adicionais
            if (result.isPaymentProof) {
                console.log('💳 Comprovante detectado:', {
                    messageId,
                    from,
                    timestamp: new Date().toISOString()
                });

                // Salva informações do comprovante no Redis
                const info = {
                    messageId,
                    timestamp: new Date().toISOString()
                };

                await this.redisStore.set(`receipt:${from}`, JSON.stringify(info), 3600); // expira em 1 hora

                // Envia mensagem pedindo o número do pedido
                await this.sendResponse(
                    from,
                    'Por favor, me informe o número do pedido relacionado a este comprovante para que eu possa validá-lo.'
                );

                return null;
            }

            // Se não for comprovante, processa normalmente
            const thread = await this.openAIService.createThread();

            await this.openAIService.addMessage(thread.id, {
                role: 'user',
                content: `Analise esta imagem e forneça uma resposta detalhada e profissional:\n${result.analysis}`
            });

            const run = await this.openAIService.runAssistant(thread.id);
            const response = await this.openAIService.waitForResponse(thread.id, run.id);

            if (!response) {
                throw new Error('Resposta do OpenAI inválida');
            }

            const formattedResponse = `🖼️ *Análise da imagem:*\n\n${response}`;
            
            await this.sendResponse(from, formattedResponse);
            return null;

        } catch (error) {
            console.error('❌ Erro ao processar imagem:', {
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
                    'Desculpe, não consegui processar sua imagem. Por favor, tente novamente ou envie uma mensagem de texto.'
                );
            }
            
            return null;
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

    async handleReceiptInfo(message) {
        try {
            const { from, text, messageId } = message;

            // Busca dados do comprovante no Redis
            const receiptKey = await this.redisStore.keys(`receipt:*`);
            if (!receiptKey || receiptKey.length === 0) {
                await this.sendResponse(
                    from,
                    'Desculpe, não encontrei nenhum comprovante pendente. Por favor, envie o comprovante novamente.'
                );
                return;
            }

            const receipt = await this.redisStore.get(receiptKey[0]);
            if (!receipt) {
                await this.sendResponse(
                    from,
                    'Desculpe, não encontrei os dados do seu comprovante. Por favor, envie o comprovante novamente.'
                );
                return;
            }

            // Tenta extrair número do pedido e nome
            const orderMatch = text.match(/#?(\d{6,})/);
            const orderNumber = orderMatch?.[1];

            if (!orderNumber) {
                await this.sendResponse(
                    from,
                    'Por favor, inclua o número do pedido começando com # (exemplo: #123456).'
                );
                return;
            }

            // Remove o número do pedido para pegar o nome
            const name = text.replace(/#?\d+/, '').trim();

            if (!name || name.length < 5) {
                await this.sendResponse(
                    from,
                    'Por favor, inclua o nome completo do titular da compra.'
                );
                return;
            }

            // Encaminha para o financeiro
            const { number: financialNumber } = settings.WHATSAPP_CONFIG.departments.financial;

            // Encaminha a imagem original
            await this.whatsAppService.forwardMessage(receipt.originalMessage, financialNumber);

            // Envia contexto para o financeiro
            const context = `*Comprovante Recebido*
📱 De: ${from}
🛍️ Pedido: #${orderNumber}
👤 Nome: ${name}
💳 Valor: ${receipt.info.valor || 'Não identificado'}
📅 Data: ${receipt.info.data || 'Não identificada'}
🏦 Banco: ${receipt.info.banco || 'Não identificado'}
👤 Beneficiário: ${receipt.info.beneficiario || 'Não identificado'}
🔄 Tipo: ${receipt.info.pix ? 'PIX' : 'Não especificado'}`;

            await this.whatsAppService.sendMessage(financialNumber, context);

            console.log('💼 Comprovante encaminhado para o financeiro:', {
                messageId: receipt.messageId,
                from,
                to: financialNumber,
                orderNumber,
                name,
                timestamp: new Date().toISOString()
            });

            // Remove o comprovante do Redis
            await this.redisStore.del(receiptKey[0]);

            // Confirma para o cliente
            await this.sendResponse(
                from,
                '✅ Obrigado! Seu comprovante foi encaminhado para nossa equipe financeira. Em breve faremos a confirmação do pagamento.'
            );

        } catch (error) {
            console.error('❌ Erro ao processar informações do comprovante:', error);
            await this.sendResponse(
                message.from,
                'Desculpe, ocorreu um erro ao processar as informações. Por favor, tente novamente.'
            );
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
