const { WhatsAppService } = require('./whatsapp-service');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { RedisStore } = require('../store/redis-store');
const { OpenAIService } = require('./openai-service');
const businessHours = require('./business-hours');

class AIServices {
    constructor(groqServices) {
        if (!groqServices) {
            throw new Error('GroqServices é obrigatório');
        }
        this.groqServices = groqServices;
        this.whatsappService = new WhatsAppService();
        this.whatsappImageService = new WhatsAppImageService();
        this.redisStore = new RedisStore();
        this.openai = new OpenAIService();
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
     * Processa uma mensagem de texto usando o OpenAI Assistant
     * @param {string} text - Texto da mensagem
     * @param {Object} options - Opções adicionais
     * @returns {Promise<string>} Resposta do processamento
     */
    async processMessage(message, options = {}) {
        try {
            const { from, messageId, isAudioTranscription = false, businessHours = false } = options;

            // Se for uma solicitação de atendimento financeiro e estiver fora do horário comercial
            if (!businessHours && message.toLowerCase().includes('financeiro')) {
                return 'Desculpe, o atendimento interno só está disponível em horário comercial (Segunda a Sexta, das 8h às 18h). Por favor, retorne durante nosso horário de atendimento. Posso ajudar com outras informações?';
            }

            // Processa a mensagem normalmente para outros casos
            let response;

            if (!message?.trim()) {
                return "Por favor, reformule sua mensagem para que eu possa entender melhor como ajudar.";
            }

            console.log('[AI] Processando mensagem:', {
                from,
                messageId,
                length: message?.length,
                preview: message?.substring(0, 100)
            });

            // Verifica se precisa de atendimento humano
            const needsHuman = await this.needsHumanSupport(message);
            if (needsHuman) {
                console.log('[AI] Encaminhando para atendimento humano');
                return businessHours.getHumanSupportMessage();
            }

            // Verifica se é questão financeira
            const isFinancial = await this.isFinancialIssue(message);
            if (isFinancial) {
                console.log('[AI] Encaminhando para financeiro');
                return businessHours.forwardToFinancial(message, from);
            }

            // Cria um thread
            const thread = await this.openai.createThread();

            // Adiciona a mensagem ao thread
            await this.openai.addMessage(thread.id, {
                role: 'user',
                content: message
            });

            // Executa o assistant
            const run = await this.openai.runAssistant(thread.id);

            // Aguarda a conclusão
            response = await this.openai.waitForRun(thread.id, run.id);

            console.log('[AI] Resposta gerada:', {
                length: response?.length,
                preview: response?.substring(0, 100)
            });

            return response || "Desculpe, não consegui gerar uma resposta. Por favor, tente novamente.";

        } catch (error) {
            console.error('[AI] Erro ao processar mensagem:', error);
            return "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes.";
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
}

module.exports = { AIServices };
