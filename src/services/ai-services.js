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
            // Extrai dados da mensagem
            let from, text;

            // Se vier no formato antigo
            if (messageData.from) {
                from = messageData.from;
                text = messageData.text;
            } 
            // Se vier no formato novo
            else if (messageData.body?.key?.remoteJid) {
                from = messageData.body.key.remoteJid.replace('@s.whatsapp.net', '');
                text = messageData.body.message?.extendedTextMessage?.text || 
                       messageData.body.message?.conversation ||
                       messageData.body.message?.text;
            }

            // Verifica se é uma mensagem de imagem
            const isImage = messageData.body?.message?.imageMessage || messageData.type === 'image';

            // Valida dados essenciais
            if (!from || (!text && !isImage)) {
                console.log('⚠️ Dados inválidos na mensagem:', {
                    from,
                    text,
                    isImage,
                    messageData: JSON.stringify(messageData, null, 2)
                });
                return null;
            }

            console.log('📨 Mensagem recebida:', {
                de: from,
                tipo: isImage ? 'imagem' : 'texto',
                texto: text || '(sem texto)',
                timestamp: new Date().toISOString()
            });

            const processKey = `processing:${from}:${messageData.body?.key?.id || messageData.messageId}`;
            
            // Verifica se já está processando
            const isProcessing = await this.redisStore.get(processKey);
            if (isProcessing) {
                console.log('⚠️ Mensagem já está sendo processada:', {
                    de: from,
                    messageId: messageData.body?.key?.id || messageData.messageId,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Marca como processando
            await this.redisStore.set(processKey, 'true', 300); // 5 minutos

            try {
                // Recupera histórico do chat
                const chatHistory = await this.getChatHistory(from);
                if (!chatHistory) {
                    console.error('❌ Erro ao recuperar histórico:', {
                        de: from,
                        timestamp: new Date().toISOString()
                    });
                    await this.sendResponse(from, 'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente mais tarde.');
                    return null;
                }

                // Verifica se tem um run ativo
                const hasActiveRun = await this.openAIService.hasActiveRun(chatHistory.threadId);
                if (hasActiveRun) {
                    console.log('⚠️ Run ativo detectado:', {
                        threadId: chatHistory.threadId,
                        timestamp: new Date().toISOString()
                    });
                    
                    await this.sendResponse(from, 'Aguarde um momento, ainda estou processando sua última mensagem...');
                    return null;
                }

                // Adiciona a mensagem ao thread
                // await this.openAIService.addMessage(chatHistory.threadId, {
                //     role: 'user',
                //     content: text
                // });

                // Processa a mensagem e deixa o Assistant decidir o que fazer
                const response = await this.openAIService.addMessageAndRun(chatHistory.threadId, {
                    role: 'user',
                    content: text
                });
                
                if (response) {
                    // Se for resposta de comando com novo threadId
                    if (typeof response === 'object' && response.threadId) {
                        // Atualiza o histórico com o novo threadId
                        chatHistory.threadId = response.threadId;
                        await this.redisStore.set(`chat:${from}`, JSON.stringify(chatHistory));
                        await this.sendResponse(from, response.message);
                    } else {
                        await this.sendResponse(from, response);
                    }
                }

            } catch (error) {
                console.error('❌ Erro ao processar mensagem:', {
                    erro: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });

                // Se for erro de run ativo, avisa para aguardar
                if (error.message.includes('while a run') && error.message.includes('is active')) {
                    await this.sendResponse(from, 'Aguarde um momento, ainda estou processando sua última mensagem...');
                } else {
                    await this.sendResponse(from, 'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente mais tarde.');
                }
            }

            await this.redisStore.set(processKey, 'true');
            return null;

        } catch (error) {
            console.error('[AI] Erro fatal ao processar mensagem:', error);
            try {
                await this.sendResponse(from, 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente ou envie uma mensagem de texto.');
            } catch (sendError) {
                console.error('❌ Erro ao enviar mensagem de fallback:', sendError);
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

            // Baixa a imagem primeiro para evitar repetição de código
            const buffer = await this.whatsAppService.downloadMediaMessage(message);
            if (!buffer || buffer.length < 100) {
                throw new Error('Buffer da imagem inválido ou muito pequeno');
            }

            // Converte para base64 uma única vez
            const base64Image = buffer.toString('base64');

            // Verifica se está esperando comprovante
            const waitingFor = await this.redisStore.get(`waiting_order:${from}`);
            const pendingOrder = await this.redisStore.get(`pending_order:${from}`);

            // Analisa com Groq para verificar se é um comprovante
            const analysis = await this.analyzeImageWithGroq(base64Image);
            
            console.log('🔍 Análise da imagem:', {
                analysis,
                timestamp: new Date().toISOString()
            });

            // Formata a mensagem para o OpenAI
            const messageContent = `[Análise de Imagem]\n${analysis}`;
            
            // Obtém ou cria thread para o usuário
            const threadId = await this.openAIService.getOrCreateThreadForCustomer(from);
            
            console.log('📝 Enviando análise para OpenAI:', {
                threadId,
                contentLength: messageContent.length,
                timestamp: new Date().toISOString() 
            });

            // Envia a análise para o OpenAI Assistant
            await this.openAIService.addMessageAndRun(threadId, {
                role: 'user',
                content: messageContent
            });

            const isPaymentProof = analysis.toLowerCase().includes('comprovante') || 
                                 analysis.toLowerCase().includes('pagamento') ||
                                 analysis.toLowerCase().includes('transferência') ||
                                 analysis.toLowerCase().includes('pix');

            if (isPaymentProof) {
                console.log('💰 Comprovante de pagamento detectado');

                // Se já está esperando comprovante e tem número do pedido
                if (waitingFor === 'payment_proof' && pendingOrder) {
                    // Valida o pedido
                    const order = await this.validateOrderForReceipt(from, pendingOrder);
                    if (order) {
                        // Encaminha para o financeiro
                        await this.openAIService.handleToolCalls({
                            function_call: {
                                name: 'forward_to_financial',
                                arguments: JSON.stringify({
                                    order_number: pendingOrder,
                                    reason: 'payment_proof',
                                    customer_message: `Cliente enviou comprovante de pagamento.\n\nAnálise da imagem:\n${analysis}`,
                                    priority: 'high',
                                    additional_info: analysis
                                })
                            }
                        }, from);

                        // Limpa o estado
                        await this.redisStore.del(`waiting_order:${from}`);
                        await this.redisStore.del(`pending_order:${from}`);

                        await this.whatsAppService.sendText(
                            from,
                            '✅ Comprovante recebido e encaminhado para análise! Em breve nossa equipe financeira irá verificar.'
                        );
                        return;
                    } else {
                        await this.whatsAppService.sendText(
                            from,
                            '❌ Não encontrei o pedido informado ou ele não pertence a você. Por favor, verifique o número e tente novamente.'
                        );
                        return;
                    }
                }
                
                // Se não estava esperando ou não tem número do pedido
                await this.openAIService.handleToolCalls({
                    function_call: {
                        name: 'request_payment_proof',
                        arguments: JSON.stringify({
                            action: 'request',
                            reason: 'payment_analysis'
                        })
                    }
                }, from);

                // Salva o comprovante temporariamente
                const proofKey = `payment_proof:${from}`;
                await this.redisStore.set(proofKey, base64Image, 'EX', 300); // Expira em 5 minutos

                return;
            }

            // Se não é comprovante ou não estava esperando um
            // Tenta extrair número do pedido
            const orderNumber = await this.orderValidationService.extractOrderNumber(buffer);
            if (orderNumber) {
                console.log(`🔍 Número do pedido encontrado na imagem: ${orderNumber}`);
                const orderInfo = await this.orderValidationService.findOrder(orderNumber);
                
                if (orderInfo) {
                    await this.handleOrderInfo(from, orderInfo);
                    return;
                }
            }

            // Se chegou aqui, é uma imagem comum
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
            try {
                await this.whatsAppService.sendText(
                    message.from,
                    'Desculpe, não consegui processar sua imagem. Por favor, tente novamente ou envie uma mensagem de texto.'
                );
            } catch (sendError) {
                console.error('❌ Erro ao enviar mensagem de erro:', sendError);
            }
        }
    }

    /**
     * Analisa uma imagem usando o Groq Vision
     * @param {string} base64Image Imagem em base64
     * @returns {Promise<string>} Análise da imagem
     */
    async analyzeImageWithGroq(base64Image) {
        try {
            console.log('🔄 Iniciando análise de imagem com Groq Vision...', {
                timestamp: new Date().toISOString(),
                imageSize: base64Image.length
            });

            const messages = [
                {
                    role: "user", 
                    content: [
                        {
                            type: "text",
                            text: `Analise esta imagem detalhadamente e me forneça as seguintes informações:

1. Tipo de Imagem/Documento:
   - Identifique se é um comprovante de pagamento
   - Foto de calçado
   - Foto dos pés para medidas
   - Tabela de medidas/numeração
   - Outro tipo de documento

2. Se for um comprovante de pagamento:
   - Valor da transação
   - Data e hora
   - Tipo de transação (PIX, TED, etc)
   - Banco ou instituição
   - Nome do beneficiário (se visível)
   - Status da transação

3. Se for uma foto de calçado ou pés:
   - Descrição do calçado ou características dos pés
   - Detalhes visíveis importantes
   - Qualidade e clareza da imagem
   - Ângulo da foto
   - Se há régua ou referência de medida

4. Se for uma tabela de medidas:
   - Tipo de medida (comprimento, largura)
   - Numerações visíveis
   - Clareza das informações

Por favor, forneça uma análise estruturada e detalhada focando no contexto de uma loja de calçados.`
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

            console.log('📤 Enviando requisição para Groq Vision...', {
                timestamp: new Date().toISOString(),
                modelVersion: "llama-3.2-90b-vision-preview"
            });

            const response = await this.groqServices.chat.completions.create({
                model: "llama-3.2-90b-vision-preview",
                messages: messages,
                temperature: 0.7,
                max_tokens: 1024,
                stream: false
            });

            if (!response?.choices?.[0]?.message?.content) {
                console.error('❌ Resposta inválida da Groq:', {
                    response,
                    timestamp: new Date().toISOString()
                });
                throw new Error('Resposta inválida da Groq');
            }

            const analysis = response.choices[0].message.content;
            
            console.log('✅ Análise concluída com sucesso:', {
                analysisLength: analysis.length,
                timestamp: new Date().toISOString()
            });

            return analysis;
        } catch (error) {
            console.error('❌ Erro ao analisar imagem com Groq:', {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
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
}

// Exporta a classe AIServices da mesma forma que os outros serviços
module.exports = { AIServices };
