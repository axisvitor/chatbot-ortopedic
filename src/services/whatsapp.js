const settings = require('../config/settings');
const httpClient = require('../utils/http-client');
const { URL } = require('url');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const businessHours = require('./business-hours');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { GroqServices } = require('./groq-services');

class WhatsAppService {
    constructor() {
        this.config = settings.WHATSAPP_CONFIG;
        this.financialDeptNumber = process.env.FINANCIAL_DEPT_NUMBER;
        this.httpClient = httpClient;
        this.groqServices = new GroqServices();
        
        // Garantir que a URL base tenha o protocolo https://
        if (!this.config.apiUrl.startsWith('http://') && !this.config.apiUrl.startsWith('https://')) {
            this.config.apiUrl = `https://${this.config.apiUrl}`;
        }
    }

    async sendMessage(to, message) {
        try {
            console.log(' Preparando envio:', {
                para: to,
                tipo: typeof to,
                tamanho: to?.length,
                mensagem: message
            });

            // Remove caracteres não numéricos e garante o código do país
            const cleanedNumber = to.replace(/\D/g, '');
            const formattedNumber = cleanedNumber.startsWith('55') ? cleanedNumber : `55${cleanedNumber}`;

            console.log(' Número processado:', {
                original: to,
                limpo: cleanedNumber,
                formatado: formattedNumber,
                tamanhos: {
                    original: to?.length,
                    limpo: cleanedNumber?.length,
                    formatado: formattedNumber?.length
                }
            });

            // Verifica se temos um número válido
            if (!formattedNumber || formattedNumber.length < 12) {
                throw new Error('Número de telefone inválido');
            }

            const body = {
                phoneNumber: formattedNumber,
                text: message,
                delayMessage: 3 // Delay padrão de 3 segundos
            };

            console.log(' Corpo da requisição:', body);

            const url = new URL('message/send-text', this.config.apiUrl);
            url.searchParams.append('connectionKey', this.config.connectionKey);
            
            console.log(' URL da requisição:', url.toString());
            console.log(' Token:', this.config.token);

            const response = await this.httpClient.post(url.toString(), body, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.token}`
                }
            });

            console.log(' Mensagem enviada com sucesso:', response.data);
            
            return response.data;
        } catch (error) {
            console.error(' Erro ao enviar mensagem:', {
                erro: error.message,
                resposta: error.response?.data,
                status: error.response?.status,
                headers: error.response?.headers,
                url: error.config?.url,
                token: this.config.token
            });
            throw error;
        }
    }

    async sendImage(to, imageUrl, caption = "") {
        try {
            // Remove caracteres não numéricos e garante o código do país
            const cleanedNumber = to.replace(/\D/g, '');
            const formattedNumber = cleanedNumber.startsWith('55') ? cleanedNumber : `55${cleanedNumber}`;

            if (!formattedNumber || formattedNumber.length < 12) {
                throw new Error('Número de telefone inválido');
            }

            const url = new URL('/message/send-image', this.config.apiUrl);
            url.searchParams.append('connectionKey', this.config.connectionKey);
            console.log(' URL da requisição:', url.toString());

            const body = {
                phoneNumber: formattedNumber,
                image: imageUrl,
                caption: caption,
                delayMessage: 3 // Delay padrão de 3 segundos
            };

            const response = await this.httpClient.post(url.toString(), body, {
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            console.error('Error sending WhatsApp image:', error);
            throw error;
        }
    }

    async sendDocument(to, documentUrl, fileName) {
        try {
            // Remove caracteres não numéricos e garante o código do país
            const cleanedNumber = to.replace(/\D/g, '');
            const formattedNumber = cleanedNumber.startsWith('55') ? cleanedNumber : `55${cleanedNumber}`;

            if (!formattedNumber || formattedNumber.length < 12) {
                throw new Error('Número de telefone inválido');
            }

            const url = new URL('/message/send-document', this.config.apiUrl);
            url.searchParams.append('connectionKey', this.config.connectionKey);
            console.log(' URL da requisição:', url.toString());

            const body = {
                phoneNumber: formattedNumber,
                document: documentUrl,
                fileName: fileName,
                delayMessage: 3 // Delay padrão de 3 segundos
            };

            const response = await this.httpClient.post(url.toString(), body, {
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            console.error('Error sending WhatsApp document:', error);
            throw error;
        }
    }

    async notifyFinancialDepartment(paymentInfo) {
        if (!this.financialDeptNumber) {
            throw new Error('Financial department number not configured');
        }

        try {
            const message = this.formatFinancialMessage(paymentInfo);
            await this.sendMessage(this.financialDeptNumber, message);

            if (paymentInfo.imageUrl) {
                await this.sendImage(
                    this.financialDeptNumber,
                    paymentInfo.imageUrl,
                    "Comprovante de pagamento anexado"
                );
            }

            return true;
        } catch (error) {
            console.error('Error notifying financial department:', error);
            throw error;
        }
    }

    formatFinancialMessage(paymentInfo) {
        const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        
        return ` Novo Comprovante de Pagamento\n\n` +
               ` Data: ${timestamp}\n` +
               ` Cliente: ${paymentInfo.customerName || 'Não identificado'}\n` +
               ` Telefone: ${paymentInfo.customerPhone || 'Não informado'}\n` +
               ` Valor: ${paymentInfo.amount || 'Não identificado'}\n` +
               ` Banco: ${paymentInfo.bank || 'Não identificado'}\n` +
               ` Tipo: ${paymentInfo.paymentType || 'Não identificado'}\n\n` +
               ` Análise do Comprovante:\n${paymentInfo.analysis || 'Sem análise disponível'}`;
    }

    async downloadMedia(mediaUrl, mediaKey, fileEncSha256) {
        try {
            console.log(' Baixando mídia do WhatsApp...');
            const response = await this.httpClient.get(mediaUrl, {
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'MediaKey': mediaKey,
                    'FileEncSha256': fileEncSha256
                },
                responseType: 'arraybuffer'
            });
            return response.data;
        } catch (error) {
            console.error(' Erro ao baixar mídia:', error);
            throw error;
        }
    }

    async extractMessageFromWebhook(webhookData) {
        try {
            if (!webhookData?.type || !webhookData?.body) {
                console.log('[Webhook] Dados inválidos:', { 
                    hasType: !!webhookData?.type,
                    hasBody: !!webhookData?.body 
                });
                return null;
            }

            const { body } = webhookData;
            
            // Extrair informações básicas
            const messageInfo = {
                type: this.getMessageType(body),
                from: body.key?.remoteJid?.replace('@s.whatsapp.net', ''),
                messageId: body.key?.id,
                timestamp: body.messageTimestamp,
                pushName: body.pushName
            };

            if (!messageInfo.from) {
                console.log('[Webhook] Remetente ausente');
                return null;
            }

            console.log('[Webhook] Mensagem recebida:', {
                type: messageInfo.type,
                from: messageInfo.from,
                messageId: messageInfo.messageId,
                pushName: messageInfo.pushName
            });

            // Processar dados específicos do tipo
            if (messageInfo.type === 'image') {
                const imageMessage = body.message?.imageMessage;
                if (!imageMessage) {
                    console.log('[Webhook] Dados da imagem ausentes');
                    return null;
                }

                messageInfo.mediaData = {
                    mimetype: imageMessage.mimetype,
                    messageType: 'image',
                    message: imageMessage
                };

                console.log('[Webhook] Imagem detectada:', {
                    mimetype: messageInfo.mediaData.mimetype,
                    hasMediaKey: !!imageMessage.mediaKey,
                    fileLength: imageMessage.fileLength
                });
            }

            return messageInfo;

        } catch (error) {
            console.error('[Webhook] Erro ao extrair mensagem:', {
                message: error.message,
                stack: error.stack
            });
            return null;
        }
    }

    getMessageType(body) {
        if (!body?.message) return 'unknown';
        
        const message = body.message;

        if (message.imageMessage) return 'image';
        if (message.audioMessage) return 'audio';
        if (message.conversation || message.extendedTextMessage) return 'text';
        
        return 'unknown';
    }

    async processWhatsAppImage(messageInfo) {
        try {
            if (!messageInfo?.mediaData?.message) {
                throw new Error('Dados da imagem ausentes ou inválidos');
            }

            console.log('[Image] Iniciando processamento da imagem');
            
            // Download da imagem
            const stream = await downloadContentFromMessage(messageInfo.mediaData.message, 'image');
            let buffer = Buffer.from([]);
            
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            console.log('[Image] Download concluído, tamanho:', buffer.length);

            // Se for um comprovante de pagamento
            if (this.isPaymentProof(messageInfo)) {
                console.log('[Image] Detectado como comprovante de pagamento');
                return this.forwardPaymentProof({
                    ...messageInfo.mediaData,
                    buffer
                }, messageInfo.from);
            }

            return {
                success: true,
                message: 'Imagem recebida com sucesso'
            };

        } catch (error) {
            console.error('[Image] Erro ao processar imagem:', {
                message: error.message,
                type: error.type,
                code: error.code
            });

            return {
                success: false,
                message: 'Desculpe, não foi possível processar sua imagem. Por favor, tente novamente.'
            };
        }
    }

    isPaymentProof(messageInfo) {
        // Implementar lógica para detectar se é um comprovante
        // Por exemplo, verificar se a conversa está em um contexto de pagamento
        // ou se o usuário indicou que está enviando um comprovante
        return true; // Por enquanto, tratamos todas as imagens como comprovantes
    }

    async handleIncomingMessage(message) {
        try {
            const autoReply = businessHours.getAutoReplyMessage();
            if (autoReply) {
                await this.sendMessage(message.key.remoteJid, autoReply);
                return;
            }

            // Processar a mensagem normalmente
            const extractedMessage = await this.extractMessageFromWebhook(message);
            if (!extractedMessage) {
                console.warn(' Mensagem não reconhecida:', message);
                return;
            }

            // Resto do código de processamento da mensagem...
        } catch (error) {
            console.error(' Erro ao processar mensagem:', error);
            throw error;
        }
    }

    async handleMediaMessage(message) {
        try {
            if (message.message.imageMessage) {
                const imageMessage = message.message.imageMessage;
                const isPaymentProof = await this._isPaymentProof(imageMessage);
                
                if (isPaymentProof) {
                    // Baixa e encaminha o comprovante
                    const mediaData = await this.downloadMedia(message);
                    await this.forwardPaymentProof(mediaData, message.key.remoteJid);
                    return {
                        text: "Recebi seu comprovante de pagamento! Ele será analisado pelo setor financeiro durante o horário comercial. Posso ajudar com mais alguma coisa?",
                        mediaHandled: true
                    };
                }
            }

            // Processa outros tipos de mídia normalmente...
            return await super.handleMediaMessage(message);
        } catch (error) {
            console.error(' Erro ao processar mídia:', error);
            throw error;
        }
    }

    async _isPaymentProof(imageMessage) {
        try {
            // Palavras-chave no texto da imagem ou na mensagem
            const paymentKeywords = [
                'comprovante',
                'pagamento',
                'transferência',
                'pix',
                'recibo',
                'boleto'
            ];

            // Verifica se há palavras-chave na legenda da imagem
            if (imageMessage.caption) {
                const caption = imageMessage.caption.toLowerCase();
                if (paymentKeywords.some(keyword => caption.includes(keyword))) {
                    return true;
                }
            }

            // Analisa a imagem com Vision
            const imageUrl = imageMessage.url;
            if (imageUrl) {
                console.log(' Analisando imagem com Vision:', { url: imageUrl });
                const analysis = await this.groqServices.analyzeImage(imageUrl);
                
                // Se a análise contiver palavras-chave relacionadas a pagamento
                const analysisText = analysis.toLowerCase();
                const isPaymentProof = paymentKeywords.some(keyword => 
                    analysisText.includes(keyword)
                );

                console.log(' Análise Vision concluída:', {
                    isPaymentProof,
                    analysisExcerpt: analysis.substring(0, 100) + '...'
                });

                return isPaymentProof;
            }

            return false;
        } catch (error) {
            console.error(' Erro ao analisar imagem:', error);
            // Em caso de erro, assume que não é comprovante
            return false;
        }
    }

    async forwardPaymentProof(mediaData, userContact) {
        try {
            const config = settings.BUSINESS_HOURS.departments.financial.paymentProofs;
            
            // Validar tipo de arquivo
            if (!config.allowedTypes.includes(mediaData.mimetype)) {
                console.log(`[PaymentProof] Tipo de arquivo inválido: ${mediaData.mimetype}`);
                return {
                    success: false,
                    message: 'Por favor, envie apenas imagens (jpg, jpeg, png).'
                };
            }

            // Baixar e salvar a imagem
            const stream = await downloadContentFromMessage(mediaData, 'image');
            const buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer.concat(chunk);
            }

            // Criar diretório se não existir
            await fs.mkdir(config.saveDir, { recursive: true });
            
            const filename = `payment_${userContact}_${Date.now()}.${mediaData.mimetype.split('/')[1]}`;
            const filepath = path.join(config.saveDir, filename);
            
            await fs.writeFile(filepath, buffer);
            console.log(`[PaymentProof] Imagem salva em: ${filepath}`);

            // Analisar a imagem com Groq Vision
            const analysis = await this.groqServices.analyzeImage(filepath);
            console.log('[PaymentProof] Análise Groq:', { 
                success: analysis.success,
                hasPaymentInfo: analysis.hasPaymentInfo 
            });

            // Preparar FormData para webhook
            const formData = new FormData();
            formData.append('file', buffer, {
                filename,
                contentType: mediaData.mimetype
            });
            formData.append('contact', userContact);
            formData.append('analysis', JSON.stringify(analysis));

            // Enviar para webhook
            try {
                await axios.post(config.webhook, formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${this.config.token}`
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                });
                console.log('[PaymentProof] Webhook enviado com sucesso');
            } catch (webhookError) {
                console.error('[PaymentProof] Erro ao enviar webhook:', {
                    status: webhookError.response?.status,
                    message: webhookError.message
                });
                throw webhookError;
            }

            return {
                success: true,
                message: 'Comprovante recebido e analisado com sucesso. Nossa equipe financeira irá verificar e confirmar o pagamento.',
                analysis
            };

        } catch (error) {
            console.error('[PaymentProof] Erro ao processar comprovante:', {
                message: error.message,
                code: error.code,
                type: error.type
            });
            
            return {
                success: false,
                message: 'Desculpe, ocorreu um erro ao processar seu comprovante. Por favor, tente novamente ou entre em contato com nosso suporte.',
                error: error.message
            };
        }
    }

    processPhoneNumber(number) {
        // Remove caracteres não numéricos e garante o código do país
        const cleanedNumber = number.replace(/\D/g, '');
        const formattedNumber = cleanedNumber.startsWith('55') ? cleanedNumber : `55${cleanedNumber}`;
        return formattedNumber;
    }
}

module.exports = { WhatsAppService };
