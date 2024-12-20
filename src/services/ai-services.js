const { WhatsAppService } = require('./whatsapp-service');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { RedisStore } = require('../store/redis-store');
const { OpenAIService } = require('./openai-service');
const { TrackingService } = require('./tracking-service');
const businessHours = require('./business-hours');
const { OrderValidationService } = require('./order-validation-service');
const { NuvemshopService } = require('./nuvemshop-service');

class AIServices {
    constructor(groqServices) {
        if (!groqServices) {
            throw new Error('GroqServices é obrigatório');
        }
        this.groqServices = groqServices;
        this.whatsappImageService = new WhatsAppImageService();
        this.redisStore = new RedisStore();
        this.openai = new OpenAIService();
        this.trackingService = new TrackingService();
        this.whatsappReady = false;  
        this.initWhatsApp();
        this.orderValidation = new OrderValidationService();
        this.nuvemshop = new NuvemshopService();
        this.CONVERSATION_EXPIRY = 60 * 24 * 60 * 60; // 60 dias em segundos
    }

    async initWhatsApp() {
        try {
            this.whatsappService = new WhatsAppService();
            await this.whatsappService.getClient();
            this.whatsappReady = true;  
            console.log('[AI] WhatsApp inicializado com sucesso');
        } catch (error) {
            console.error('[AI] Erro ao inicializar WhatsApp:', error);
            throw error;
        }
    }

    /**
     * Processa um comprovante de pagamento
     * @param {string} imageUrl - URL da imagem
     * @param {Object} options - Opções adicionais
     * @returns {Promise<Object>} Informações do pagamento
     */
    async processPaymentProof(imageUrl, { messageInfo, from } = {}) {
        try {
            console.log('[AI] Processando comprovante:', {
                hasUrl: !!imageUrl,
                hasMessageInfo: !!messageInfo,
                from
            });

            // Baixa e processa a imagem
            const imageBuffer = await this.whatsappImageService.downloadImage(imageUrl, messageInfo);
            
            // Análise com Groq
            const imageAnalysis = await this.groqServices.analyzeImage(imageBuffer);

            // Processa o resultado
            const paymentInfo = {
                imageUrl,
                from,
                amount: this.extractAmount(imageAnalysis),
                bank: this.extractBank(imageAnalysis),
                paymentType: this.extractPaymentType(imageAnalysis),
                analysis: imageAnalysis,
                isPaymentProof: this.isPaymentProof(imageAnalysis),
                timestamp: new Date().toISOString()
            };

            console.log('[AI] Verificando se é comprovante:', {
                analysis: imageAnalysis.substring(0, 100),
                keywords: this.findMatchingKeywords(imageAnalysis),
                hasAmount: /R\$\s*\d+(?:\.\d{3})*(?:,\d{2})?/.test(imageAnalysis),
                hasDate: /\d{2}\/\d{2}\/\d{4}/.test(imageAnalysis)
            });

            // Log das informações extraídas
            console.log('[AI] Informações extraídas:', {
                amount: paymentInfo.amount,
                bank: paymentInfo.bank,
                paymentType: paymentInfo.paymentType,
                isPaymentProof: paymentInfo.isPaymentProof
            });

            // Se for comprovante, inicia o fluxo de coleta de nome
            if (paymentInfo.isPaymentProof) {
                const redisKey = `payment:${paymentInfo.timestamp}:${from}`;
                await this.redisStore.set(redisKey, JSON.stringify(paymentInfo), 86400 * 30);
                
                // Salva o estado do usuário para esperar o nome
                await this.redisStore.set(`state:${from}`, JSON.stringify({
                    state: 'waiting_name',
                    paymentKey: redisKey
                }), 3600); // expira em 1 hora

                // Envia mensagem solicitando o nome
                await this.whatsappService.sendTextMessage(
                    from,
                    "✅ Comprovante recebido! Por favor, me informe seu nome completo para que eu possa encaminhar para análise."
                );
            } else {
                // Se não for comprovante, responde diretamente
                await this.whatsappService.sendTextMessage(
                    from,
                    "❌ A imagem enviada não parece ser um comprovante de pagamento válido. Por favor, envie um comprovante de transferência, PIX ou depósito."
                );
            }

            return paymentInfo;
        } catch (error) {
            console.error('[AI] Erro ao processar comprovante:', error);
            throw error;
        }
    }

    /**
     * Processa a resposta do nome do usuário
     * @param {string} from - Número do WhatsApp do usuário
     * @param {string} message - Mensagem com o nome do usuário
     */
    async processUserName(from, message) {
        try {
            // Verifica se está esperando o nome
            const stateJson = await this.redisStore.get(`state:${from}`);
            if (!stateJson) return null;

            const state = JSON.parse(stateJson);
            if (state.state !== 'waiting_name') return null;

            // Recupera as informações do pagamento
            const paymentJson = await this.redisStore.get(state.paymentKey);
            if (!paymentJson) return null;

            const paymentInfo = JSON.parse(paymentJson);
            
            // Adiciona o nome ao pagamento
            paymentInfo.buyerName = message.trim();
            await this.redisStore.set(state.paymentKey, JSON.stringify(paymentInfo), 86400 * 30);

            // Limpa o estado
            await this.redisStore.del(`state:${from}`);

            // Envia confirmação para o usuário
            await this.whatsappService.sendTextMessage(
                from,
                "✅ Obrigado! Seu comprovante foi encaminhado para análise. Em breve retornaremos com a confirmação."
            );

            // Envia análise detalhada para o setor financeiro
            if (process.env.FINANCIAL_DEPT_NUMBER) {
                const formattedDate = new Date(paymentInfo.timestamp).toLocaleString('pt-BR');
                const formattedPhone = this.formatPhoneNumber(from);
                await this.whatsappService.sendTextMessage(
                    process.env.FINANCIAL_DEPT_NUMBER,
                    `📋 *Novo Comprovante de Pagamento*\n\n` +
                    `📅 Data: ${formattedDate}\n` +
                    `👤 Cliente: ${paymentInfo.buyerName}\n` +
                    `📱 Telefone: ${formattedPhone}\n` +
                    `💰 Valor: ${paymentInfo.amount || 'Não identificado'}\n` +
                    `🏦 Banco: ${paymentInfo.bank || 'Não identificado'}\n` +
                    `💳 Tipo: ${paymentInfo.paymentType || 'Não identificado'}\n\n` +
                    `📝 *Análise do Comprovante:*\n${paymentInfo.analysis}`
                );
            }

            return paymentInfo;
        } catch (error) {
            console.error('[AI] Erro ao processar nome do usuário:', error);
            throw error;
        }
    }

    /**
     * Encontra as palavras-chave presentes no texto
     * @param {string} text - Texto para buscar
     * @returns {string[]} Lista de palavras-chave encontradas
     */
    findMatchingKeywords(text) {
        const keywords = [
            'comprovante',
            'pagamento',
            'transferência',
            'pix',
            'ted',
            'doc',
            'boleto',
            'recibo',
            'valor final',
            'destinatário',
            'pagador'
        ];
        
        const lowerText = text.toLowerCase();
        return keywords.filter(keyword => lowerText.includes(keyword.toLowerCase()));
    }

    /**
     * Verifica se o texto indica um comprovante de pagamento
     * @param {string} analysis - Texto da análise
     * @returns {boolean} true se for comprovante
     */
    isPaymentProof(analysis) {
        const hasKeywords = this.findMatchingKeywords(analysis).length >= 2; // Pelo menos 2 palavras-chave
        
        // Verifica se tem valor monetário (R$)
        const hasAmount = /R\$\s*\d+(?:\.\d{3})*(?:,\d{2})?/.test(analysis);
        
        // Verifica se tem data
        const hasDate = /\d{2}\/\d{2}\/\d{4}/.test(analysis);
        
        // Considera comprovante se tiver palavras-chave E valor E data
        return hasKeywords && hasAmount && hasDate;
    }

    /**
     * Extrai o valor do pagamento do texto da análise
     * @param {string} analysis - Texto da análise
     * @returns {string|null} Valor do pagamento ou null se não encontrado
     */
    extractAmount(analysis) {
        try {
            const matches = analysis.match(/R\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)/);
            if (matches) {
                return matches[0].trim();
            }
            return null;
        } catch (error) {
            console.error('[AI] Erro ao extrair valor:', error);
            return null;
        }
    }

    /**
     * Extrai o banco do texto da análise
     * @param {string} analysis - Texto da análise
     * @returns {string|null} Nome do banco ou null se não encontrado
     */
    extractBank(analysis) {
        try {
            const bankPatterns = [
                /(?:banco|bank)\s+([^.,\n]+)/i,
                /(?:origem|destino):\s*([^.,\n]+)/i,
                /banrisul[^.,\n]*/i,
                /banco do estado[^.,\n]*/i
            ];

            for (const pattern of bankPatterns) {
                const match = analysis.match(pattern);
                if (match) {
                    return match[0].trim();
                }
            }
            return null;
        } catch (error) {
            console.error('[AI] Erro ao extrair banco:', error);
            return null;
        }
    }

    /**
     * Extrai o tipo de pagamento do texto da análise
     * @param {string} analysis - Texto da análise
     * @returns {string|null} Tipo de pagamento ou null se não encontrado
     */
    extractPaymentType(analysis) {
        try {
            const typePatterns = [
                /\b(pix)\b/i,
                /\b(ted)\b/i,
                /\b(doc)\b/i,
                /\b(transferência)\b/i,
                /tipo de transação:\s*([^.,\n]+)/i
            ];

            for (const pattern of typePatterns) {
                const match = analysis.match(pattern);
                if (match) {
                    return match[1] ? match[1].toUpperCase() : match[0].toUpperCase();
                }
            }
            return null;
        } catch (error) {
            console.error('[AI] Erro ao extrair tipo de pagamento:', error);
            return null;
        }
    }

    /**
     * Formata um número de telefone para exibição
     * @param {string} phone - Número do telefone
     * @returns {string} Número formatado
     */
    formatPhoneNumber(phone) {
        try {
            // Remove tudo que não for número
            const numbers = phone.replace(/\D/g, '');
            
            // Se começar com 55, formata como brasileiro
            if (numbers.startsWith('55')) {
                const ddd = numbers.slice(2, 4);
                const part1 = numbers.slice(4, 9);
                const part2 = numbers.slice(9, 13);
                return `(${ddd}) ${part1}-${part2}`;
            }
            
            // Se não, retorna como está
            return phone;
        } catch (error) {
            return phone;
        }
    }

    /**
     * Armazena uma mensagem no histórico de conversas
     * @param {string} from - Número do WhatsApp
     * @param {string} role - Papel (user/assistant)
     * @param {string} content - Conteúdo da mensagem
     * @private
     */
    async _storeMessage(from, role, content) {
        try {
            const timestamp = Date.now();
            const messageKey = `conversation:${from}:${timestamp}`;
            const message = {
                role,
                content,
                timestamp,
                phoneNumber: from
            };

            // Armazena a mensagem individual como JSON string
            await this.redisStore.set(messageKey, JSON.stringify(message), this.CONVERSATION_EXPIRY);

            // Adiciona à lista de mensagens do usuário
            const userMessagesKey = `user_messages:${from}`;
            await this.redisStore.rpush(userMessagesKey, messageKey);
            await this.redisStore.expire(userMessagesKey, this.CONVERSATION_EXPIRY);

            // Adiciona à lista global de mensagens
            const globalMessagesKey = 'all_conversations';
            await this.redisStore.rpush(globalMessagesKey, messageKey);
            await this.redisStore.expire(globalMessagesKey, this.CONVERSATION_EXPIRY);

            console.log('[Conversation] Mensagem armazenada:', {
                from,
                role,
                timestamp,
                contentLength: content?.length,
                messageKey
            });
        } catch (error) {
            console.error('[Conversation] Erro ao armazenar mensagem:', error);
            // Não propaga o erro para não interromper o fluxo principal
        }
    }

    /**
     * Recupera o histórico de conversas de um usuário
     * @param {string} from - Número do WhatsApp
     * @returns {Promise<Array>} Lista de mensagens
     */
    async getUserConversationHistory(from) {
        try {
            const userMessagesKey = `user_messages:${from}`;
            const messageKeys = await this.redisStore.lrange(userMessagesKey, 0, -1);
            
            const messages = [];
            for (const key of messageKeys) {
                const messageJson = await this.redisStore.get(key);
                if (messageJson) {
                    messages.push(JSON.parse(messageJson));
                }
            }

            return messages.sort((a, b) => a.timestamp - b.timestamp);
        } catch (error) {
            console.error('[Conversation] Erro ao recuperar histórico:', error);
            return [];
        }
    }

    /**
     * Recupera todas as conversas para fine-tuning
     * @returns {Promise<Array>} Lista de todas as conversas
     */
    async getAllConversationsForFineTuning() {
        try {
            const globalMessagesKey = 'all_conversations';
            const messageKeys = await this.redisStore.lrange(globalMessagesKey, 0, -1);
            
            const messages = [];
            for (const key of messageKeys) {
                const messageJson = await this.redisStore.get(key);
                if (messageJson) {
                    messages.push(JSON.parse(messageJson));
                }
            }

            // Agrupa mensagens por número de telefone
            const conversationsByUser = messages.reduce((acc, msg) => {
                if (!acc[msg.phoneNumber]) {
                    acc[msg.phoneNumber] = [];
                }
                acc[msg.phoneNumber].push(msg);
                return acc;
            }, {});

            // Ordena mensagens de cada usuário por timestamp
            Object.values(conversationsByUser).forEach(userMessages => {
                userMessages.sort((a, b) => a.timestamp - b.timestamp);
            });

            return conversationsByUser;
        } catch (error) {
            console.error('[Conversation] Erro ao recuperar todas as conversas:', error);
            return {};
        }
    }

    /**
     * Processa uma mensagem de texto usando o OpenAI Assistant
     * @param {string} text - Texto da mensagem
     * @param {Object} options - Opções adicionais
     * @returns {Promise<string>} Resposta do processamento
     */
    async processMessage(text, { from, messageId, businessHours = true } = {}) {
        if (!text) return null;

        try {
            console.log('[AI] Processando mensagem:', {
                from,
                messageId,
                length: text?.length,
                preview: text
            });

            // Verifica se é a primeira mensagem do usuário
            const firstMessageKey = `first_message_${from}`;
            const isFirstMessage = !(await this.redisStore.get(firstMessageKey));
            
            if (isFirstMessage) {
                // Marca que não é mais primeira mensagem
                await this.redisStore.set(firstMessageKey, 'true');
                // Envia mensagem de boas-vindas
                await this.whatsappService.sendText(from, 'Olá! 👋 Sou o assistente virtual da Loja Ortopedic. Em que posso ajudar você hoje?');
            }

            // Verifica se é um código de rastreio (formato típico dos Correios)
            const trackingRegex = /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/;
            if (trackingRegex.test(text)) {
                console.log('[AI] Código de rastreio detectado:', text);
                
                // Armazena o código de rastreio
                await this.redisStore.set(`tracking_${from}`, text);
                
                // Solicita o CPF
                await this.whatsappService.sendText(from, 'Ótimo! Agora, para confirmar sua identidade e garantir a segurança das informações, preciso que você me informe seu CPF (apenas números). Por favor, digite seu CPF:');
                
                // Marca que estamos esperando o CPF
                await this.redisStore.set(`waiting_cpf_${from}`, 'true');
                
                return;
            }

            // Verifica se é um CPF (apenas números, 11 dígitos)
            const cpfRegex = /^\d{11}$/;
            if (cpfRegex.test(text)) {
                // Verifica se estamos esperando um CPF
                const isWaitingCpf = await this.redisStore.get(`waiting_cpf_${from}`);
                
                if (isWaitingCpf) {
                    // Recupera o código de rastreio armazenado
                    const trackingNumber = await this.redisStore.get(`tracking_${from}`);
                    
                    if (trackingNumber) {
                        await this.whatsappService.sendText(from, 'Obrigado! Vou verificar o status do seu pedido agora mesmo. Um momento, por favor! \n\n🔍✨');
                        
                        try {
                            // Registra e consulta o rastreamento com o CPF
                            const trackingInfo = await this.trackingService.processTrackingRequest(trackingNumber, text);
                            
                            // Limpa as chaves do Redis
                            await this.redisStore.del(`tracking_${from}`);
                            await this.redisStore.del(`waiting_cpf_${from}`);
                            
                            // Envia o resultado do rastreamento
                            if (trackingInfo) {
                                await this.whatsappService.sendText(from, trackingInfo);
                            } else {
                                await this.whatsappService.sendText(from, 'Desculpe, não consegui encontrar informações sobre este código de rastreamento. Por favor, verifique se o código está correto.');
                            }
                            return;
                        } catch (error) {
                            console.error('[AI] Erro ao processar rastreamento:', error);
                            await this.whatsappService.sendText(from, 'Desculpe, ocorreu um erro ao consultar o rastreamento. Por favor, tente novamente mais tarde.');
                            return;
                        }
                    }
                }
            }

            // Verifica se é uma consulta de pedido
            const orderMatch = text.match(/pedido\s+(\d+)/i);
            if (orderMatch) {
                const orderNumber = orderMatch[1];
                
                // Valida se o pedido existe
                const order = await this.orderValidation.validateOrderNumber(orderNumber);
                if (!order) {
                    await this.orderValidation.incrementAttempts(from);
                    return `❌ Desculpe, não encontrei nenhum pedido com o número ${orderNumber}.
Por favor, verifique o número e tente novamente.`;
                }

                // Solicita CPF para validação
                await this.redisStore.set(`pending_order_${from}`, orderNumber);
                return `Para sua segurança, preciso confirmar sua identidade.
Por favor, me informe os últimos 4 dígitos do seu CPF.`;
            }

            // Verifica se está aguardando CPF para validação de pedido
            const pendingOrder = await this.redisStore.get(`pending_order_${from}`);
            if (pendingOrder) {
                // Extrai os 4 últimos dígitos do CPF
                const cpfMatch = text.match(/\b\d{4}\b/);
                if (!cpfMatch) {
                    return `Por favor, me informe apenas os últimos 4 dígitos do seu CPF.`;
                }

                const lastFourCPF = cpfMatch[0];
                const isValid = await this.orderValidation.validateCPF(pendingOrder, lastFourCPF);

                if (!isValid) {
                    await this.orderValidation.incrementAttempts(from);
                    await this.redisStore.del(`pending_order_${from}`);
                    return `❌ Desculpe, os dados informados não conferem.
Por favor, verifique e tente novamente.`;
                }

                // CPF válido, retorna informações do pedido
                const order = await this.orderValidation.validateOrderNumber(pendingOrder);
                const safeOrderInfo = this.orderValidation.formatSafeOrderInfo(order);
                const message = this.orderValidation.formatOrderMessage(safeOrderInfo);

                // Limpa o pedido pendente e reseta tentativas
                await this.redisStore.del(`pending_order_${from}`);
                await this.orderValidation.resetAttempts(from);

                return message;
            }

            // Verifica se o usuário está bloqueado
            const isBlocked = await this.orderValidation.checkAttempts(from);
            if (isBlocked) {
                return `⚠️ Por segurança, suas tentativas de consulta foram bloqueadas por 30 minutos. 
Por favor, tente novamente mais tarde.`;
            }

            // Se for uma solicitação de atendimento financeiro e estiver fora do horário comercial
            if (await this.isFinancialIssue(text) && !businessHours) {
                const response = 'Nosso atendimento financeiro funciona de Segunda a Sexta, das 8h às 18h. Por favor, retorne durante nosso horário comercial para que possamos te ajudar da melhor forma possível! 🕒';
                await this.whatsappService.sendText(from, response);
                return response;
            }

            // Verifica se é uma solicitação de atendimento humano
            if (await this.needsHumanSupport(text)) {
                const response = 'Entendo que você deseja falar com um atendente humano. Por favor, aguarde um momento enquanto direciono seu atendimento. 👨‍💼';
                await this.whatsappService.sendText(from, response);
                return response;
            }

            // Cria um thread para esta conversa
            const thread = await this.openai.createThread();

            // Adiciona o contexto como uma mensagem do usuário
            await this.openai.addMessage(thread.id, {
                role: 'user',
                content: 'Instruções importantes: Quando o cliente perguntar sobre status de pedido ou rastreamento, peça apenas o número do pedido. Não mencione CPF neste momento.'
            });

            // Adiciona a mensagem do usuário
            await this.openai.addMessage(thread.id, {
                role: 'user',
                content: text
            });

            // Executa o assistant
            const run = await this.openai.runAssistant(thread.id);

            // Aguarda a conclusão
            let response = await this.openai.waitForRun(thread.id, run.id);

            // Remove saudação duplicada se for primeira mensagem
            if (isFirstMessage && response) {
                response = response.replace(/^(olá!?|oi!?|hey!?)\s*👋?\s*/i, '');
            }

            console.log('[AI] Resposta gerada:', {
                length: response?.length,
                preview: response?.substring(0, 100)
            });

            // Armazena a mensagem do usuário
            await this._storeMessage(from, 'user', text);

            // Armazena a resposta do assistente
            if (response) {
                await this._storeMessage(from, 'assistant', response);
                await this.whatsappService.sendText(from, response);
                console.log('[AI] Mensagem enviada:', {
                    para: from,
                    resposta: response
                });
            } else {
                const errorMessage = 'Desculpe, não consegui gerar uma resposta. Por favor, tente novamente.';
                await this._storeMessage(from, 'assistant', errorMessage);
                await this.whatsappService.sendText(from, errorMessage);
            }

            return response;
        } catch (error) {
            console.error('[AI] Erro ao processar mensagem:', error);
            const errorMessage = "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes.";
            await this._storeMessage(from, 'assistant', errorMessage);
            return errorMessage;
        }
    }

    async waitForAssistantResponse(threadId, runId, timeout = 30000) {
        const startTime = Date.now();
        
        while (true) {
            const runStatus = await this.openai.checkRunStatus(threadId, runId);
            
            if (runStatus.status === 'completed') {
                const messages = await this.openai.listMessages(threadId);
                const assistantMessage = messages.data.find(msg => msg.role === 'assistant');
                
                if (!assistantMessage?.content?.[0]?.text?.value) {
                    throw new Error('Resposta inválida do Assistant');
                }
                
                return assistantMessage.content[0].text.value;
            }
            
            if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
                throw new Error(`Assistant run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
            }
            
            if (Date.now() - startTime > timeout) {
                throw new Error('Assistant timeout after 30 seconds');
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    /**
     * Processa um áudio
     * @param {string} audioUrl - URL do áudio
     * @param {Object} options - Opções adicionais
     * @returns {Promise<string>} Texto transcrito
     */
    async processAudio(audioUrl, { messageInfo, from } = {}) {
        try {
            console.log('[AI] Processando áudio:', {
                hasUrl: !!audioUrl,
                hasMessageInfo: !!messageInfo,
                from
            });

            // Processa o áudio com Groq
            const transcription = await this.groqServices.processWhatsAppAudio({
                audioMessage: {
                    ...messageInfo,
                    url: audioUrl
                }
            });

            // Log da transcrição
            console.log('[AI] Áudio transcrito:', {
                length: transcription.length,
                preview: transcription.substring(0, 100) + '...'
            });

            return transcription;
        } catch (error) {
            console.error('[AI] Erro ao processar áudio:', error);
            throw error;
        }
    }

    /**
     * Verifica se uma mensagem precisa de atendimento humano
     * @param {string} message - Mensagem do usuário
     * @returns {Promise<boolean>} true se precisar de atendimento humano
     */
    async needsHumanSupport(message) {
        try {
            const keywords = [
                'falar com atendente',
                'falar com humano',
                'atendimento humano',
                'pessoa real',
                'não quero falar com robô',
                'preciso de ajuda urgente',
                'problema grave',
                'reclamação'
            ];

            const lowerMessage = message.toLowerCase();
            return keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
        } catch (error) {
            console.error('[AI] Erro ao verificar necessidade de suporte:', error);
            return true; // Em caso de erro, melhor encaminhar para humano
        }
    }

    /**
     * Verifica se uma mensagem está relacionada a questões financeiras
     * @param {string} message - Mensagem do usuário
     * @returns {Promise<boolean>} true se for questão financeira
     */
    async isFinancialIssue(message) {
        try {
            const keywords = [
                'pagamento',
                'reembolso',
                'estorno',
                'cobrança',
                'fatura',
                'boleto',
                'cartão',
                'pix',
                'transferência',
                'dinheiro',
                'valor',
                'preço',
                'desconto',
                'promoção'
            ];

            const lowerMessage = message.toLowerCase();
            return keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
        } catch (error) {
            console.error('[AI] Erro ao verificar questão financeira:', error);
            return false;
        }
    }

    /**
     * Processa perguntas sobre produtos
     * @param {string} text - Texto da pergunta
     * @returns {Promise<string>} Resposta formatada
     */
    async processProductQuery(text) {
        try {
            // Verifica se é uma busca por produtos
            if (this.isProductSearch(text)) {
                const searchTerm = this.extractSearchTerm(text);
                const filters = this.extractFilters(text);
                const products = await this.nuvemshop.searchProducts(searchTerm, filters);
                return this.nuvemshop.formatProductsResponse(products);
            }

            // Verifica se é uma busca por categoria
            if (this.isCategorySearch(text)) {
                const category = this.extractCategory(text);
                const filters = this.extractFilters(text);
                const products = await this.nuvemshop.getProductsByCategory(category, filters);
                return this.nuvemshop.formatProductsResponse(products);
            }

            // Verifica se é uma pergunta sobre um produto específico
            if (this.isProductDetails(text)) {
                const productId = await this.getProductIdFromContext(text);
                if (productId) {
                    const product = await this.nuvemshop.getProduct(productId);
                    return this.formatProductDetails(product);
                }
            }

            // Verifica se é uma pergunta sobre tamanhos
            if (this.isSizeQuestion(text)) {
                return this.handleSizeQuestion(text);
            }

            return null; // Não é uma pergunta sobre produtos
        } catch (error) {
            console.error('[AI] Erro ao processar pergunta sobre produtos:', error);
            throw error;
        }
    }

    /**
     * Verifica se é uma busca por produtos
     * @param {string} text - Texto para analisar
     * @returns {boolean} Se é uma busca por produtos
     */
    isProductSearch(text) {
        const searchPatterns = [
            /(?:procuro|busco|quero|tem|existe|vendem?|comercializam?)\s+(.+)/i,
            /(?:onde|como)\s+(?:encontro|acho|compro)\s+(.+)/i,
            /(?:qual|quais|que)\s+(?:calçado|tênis|sapato|sandália|bota)\s+(.+)/i,
            /mostrar?(?:\s+os)?\s+(?:calçados?|tênis|sapatos|sandálias|botas)\s+(.+)/i
        ];

        return searchPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Extrai o termo de busca do texto
     * @param {string} text - Texto para extrair
     * @returns {string} Termo de busca
     */
    extractSearchTerm(text) {
        const searchPatterns = [
            /(?:procuro|busco|quero|tem|existe|vendem?|comercializam?)\s+(.+)/i,
            /(?:onde|como)\s+(?:encontro|acho|compro)\s+(.+)/i,
            /(?:qual|quais|que)\s+(?:calçado|tênis|sapato|sandália|bota)\s+(.+)/i,
            /mostrar?(?:\s+os)?\s+(?:calçados?|tênis|sapatos|sandálias|botas)\s+(.+)/i
        ];

        for (const pattern of searchPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }

        return text.trim();
    }

    /**
     * Extrai filtros do texto
     * @param {string} text - Texto para extrair
     * @returns {Object} Filtros encontrados
     */
    extractFilters(text) {
        const filters = {};

        // Extrai tamanho
        const sizeMatch = text.match(/(?:tamanho|número|tam\.?|nº)\s*(\d{2})/i);
        if (sizeMatch) {
            filters.tamanho = sizeMatch[1];
        }

        // Extrai cor
        const colorMatch = text.match(/(?:cor|na cor)\s+(\w+)/i);
        if (colorMatch) {
            filters.cor = colorMatch[1];
        }

        // Extrai faixa de preço
        const priceMatch = text.match(/(?:até|menos de|máximo)\s*R?\$?\s*(\d+)/i);
        if (priceMatch) {
            filters.preco_max = parseInt(priceMatch[1]);
        }

        const minPriceMatch = text.match(/(?:acima de|mais de|mínimo)\s*R?\$?\s*(\d+)/i);
        if (minPriceMatch) {
            filters.preco_min = parseInt(minPriceMatch[1]);
        }

        return filters;
    }

    /**
     * Verifica se é uma busca por categoria
     * @param {string} text - Texto para analisar
     * @returns {boolean} Se é uma busca por categoria
     */
    isCategorySearch(text) {
        const categoryPatterns = [
            /(?:produtos|calçados)\s+da\s+categoria\s+(.+)/i,
            /(?:mostrar?|ver|listar?)\s+(?:categoria|departamento)\s+(.+)/i,
            /(?:o\s+que\s+tem\s+(?:em|na|no)\s+(?:categoria|departamento)\s+(.+))/i,
            /(?:quero|procuro)\s+(?:ver|olhar)\s+(?:os|as)\s+(.+)/i
        ];

        return categoryPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Extrai a categoria do texto
     * @param {string} text - Texto para extrair
     * @returns {string} Nome da categoria
     */
    extractCategory(text) {
        const categoryPatterns = [
            /(?:produtos|calçados)\s+da\s+categoria\s+(.+)/i,
            /(?:mostrar?|ver|listar?)\s+(?:categoria|departamento)\s+(.+)/i,
            /(?:o\s+que\s+tem\s+(?:em|na|no)\s+(?:categoria|departamento)\s+(.+))/i,
            /(?:quero|procuro)\s+(?:ver|olhar)\s+(?:os|as)\s+(.+)/i
        ];

        for (const pattern of categoryPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }

        return text.trim();
    }

    /**
     * Verifica se é uma pergunta sobre tamanhos
     * @param {string} text - Texto para analisar
     * @returns {boolean} Se é uma pergunta sobre tamanhos
     */
    isSizeQuestion(text) {
        const sizePatterns = [
            /qual(?:is)?\s+(?:o|os)\s+tamanho/i,
            /tem\s+(?:número|tamanho)/i,
            /(?:vem|disponível)\s+em\s+que\s+(?:número|tamanho)/i,
            /tabela\s+de\s+(?:tamanho|medida)/i
        ];

        return sizePatterns.some(pattern => pattern.test(text));
    }

    /**
     * Processa perguntas sobre tamanhos
     * @param {string} text - Texto da pergunta
     * @returns {string} Resposta formatada
     */
    handleSizeQuestion(text) {
        // Se perguntou sobre tabela de medidas
        if (text.match(/tabela\s+de\s+(?:tamanho|medida)/i)) {
            return this.formatSizeGuide();
        }

        // Se perguntou sobre tamanhos disponíveis de um produto específico
        const productMatch = text.match(/(?:número|tamanho)\s+do\s+(?:calçado|produto)\s+(\d+)/i);
        if (productMatch) {
            return this.getProductSizes(productMatch[1]);
        }

        // Resposta genérica sobre tamanhos
        return `Nossos calçados estão disponíveis nos seguintes tamanhos:\n\n` +
               `👨 *Masculino:* ${SHOE_SIZES.adulto.masculino.join(', ')}\n` +
               `👩 *Feminino:* ${SHOE_SIZES.adulto.feminino.join(', ')}\n` +
               `👦 *Infantil Masculino:* ${SHOE_SIZES.infantil.menino.join(', ')}\n` +
               `👧 *Infantil Feminino:* ${SHOE_SIZES.infantil.menina.join(', ')}\n\n` +
               `_Para saber os tamanhos disponíveis de um produto específico, me envie o número dele._`;
    }

    /**
     * Formata o guia de tamanhos
     * @returns {string} Guia de tamanhos formatado
     */
    formatSizeGuide() {
        return `📏 *Guia de Tamanhos*\n\n` +
               `Para encontrar seu tamanho ideal:\n\n` +
               `1️⃣ Meça seu pé do calcanhar até o dedo mais longo\n` +
               `2️⃣ Compare com nossa tabela de medidas\n` +
               `3️⃣ Em caso de dúvida, opte pelo tamanho maior\n\n` +
               `*Dica:* Faça a medição no final do dia, quando os pés estão naturalmente mais inchados.\n\n` +
               `_Para medidas específicas de um modelo, me envie o número do produto._`;
    }

    /**
     * Obtém os tamanhos disponíveis de um produto
     * @param {string} productId - ID do produto
     * @returns {Promise<string>} Tamanhos disponíveis formatados
     */
    async getProductSizes(productId) {
        try {
            const product = await this.nuvemshop.getProduct(productId);
            if (!product) {
                return "Desculpe, não encontrei o produto solicitado.";
            }

            const tamanhos = [...new Set(product.variants
                .filter(v => v.stock > 0)
                .map(v => v.tamanho)
                .filter(Boolean)
            )].sort();

            if (tamanhos.length === 0) {
                return `Desculpe, o produto ${product.name} está indisponível no momento.`;
            }

            return `📏 *Tamanhos disponíveis para ${product.name}:*\n\n` +
                   `${tamanhos.join(', ')}\n\n` +
                   `_Para mais informações sobre um tamanho específico, me informe qual você deseja._`;
        } catch (error) {
            console.error('[AI] Erro ao buscar tamanhos do produto:', error);
            return "Desculpe, ocorreu um erro ao buscar os tamanhos disponíveis.";
        }
    }

    /**
     * Verifica se é uma pergunta sobre detalhes de produto
     * @param {string} text - Texto para analisar
     * @returns {boolean} Se é uma pergunta sobre detalhes
     */
    isProductDetails(text) {
        const detailsPatterns = [
            /(?:detalhes|informações|especificações)\s+do\s+produto\s+(\d+)/i,
            /(?:mais|saber)\s+sobre\s+(?:o\s+)?produto\s+(\d+)/i,
            /^(\d+)$/i // Apenas o número do produto
        ];

        return detailsPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Obtém o ID do produto do contexto
     * @param {string} text - Texto para extrair
     * @returns {Promise<number|null>} ID do produto ou null
     */
    async getProductIdFromContext(text) {
        // Tenta extrair o ID diretamente do texto
        const match = text.match(/(\d+)/);
        if (match) {
            return parseInt(match[1]);
        }

        return null;
    }

    /**
     * Formata detalhes do produto para resposta
     * @param {Object} product - Produto para formatar
     * @returns {string} Mensagem formatada
     */
    formatProductDetails(product) {
        if (!product) {
            return "Desculpe, não encontrei o produto solicitado.";
        }

        let message = `🏷️ *${product.name}*\n\n`;
        
        if (product.description) {
            message += `📝 *Descrição:*\n${product.description}\n\n`;
        }

        message += `💰 *Preço:* ${product.price}\n`;
        
        if (product.promotional_price) {
            message += `🏷️ *Preço Promocional:* ${product.promotional_price}\n`;
        }

        message += `📦 *Estoque:* ${product.stock} unidades\n\n`;

        if (product.variants && product.variants.length > 0) {
            message += "*Variações Disponíveis:*\n";
            product.variants.forEach(variant => {
                message += `▫️ ${variant.name}: ${variant.price} (${variant.stock} em estoque)\n`;
            });
            message += "\n";
        }

        if (product.categories && product.categories.length > 0) {
            message += `📑 *Categorias:* ${product.categories.join(', ')}\n\n`;
        }

        if (product.images && product.images.length > 0) {
            message += "_Este produto possui imagens disponíveis. Deseja visualizá-las?_";
        }

        return message;
    }
}

module.exports = { AIServices };
