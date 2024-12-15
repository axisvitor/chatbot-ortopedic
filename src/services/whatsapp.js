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
            console.log('[Webhook] Dados recebidos:', JSON.stringify(webhookData, null, 2));

            // Validação básica
            if (!webhookData?.body || !webhookData.type) {
                console.warn('[Webhook] Dados inválidos:', { hasBody: !!webhookData?.body, type: webhookData?.type });
                return null;
            }

            const messageTypes = this._getMessageTypes(webhookData.body);
            console.log('[MessageType] Tipos encontrados:', messageTypes);

            if (!messageTypes.length) {
                console.warn('[Webhook] Nenhum tipo de mensagem identificado');
                return null;
            }

            const messageType = messageTypes[0];
            const messageContent = webhookData.body;
            const messageData = messageContent?.message || {};

            // Extrai o texto e metadados
            const extractedText = this._extractMessageText(messageData);
            const metadata = this._extractMessageMetadata(messageContent);

            // Monta a mensagem base
            let extractedMessage = {
                event: webhookData.type,
                type: this._getBaseMessageType(messageType),
                ...metadata,
                ...extractedText
            };

            // Adiciona dados específicos do tipo de mensagem
            extractedMessage = this._addTypeSpecificData(extractedMessage, messageData, messageType);

            console.log('[Webhook] Mensagem extraída:', {
                event: extractedMessage.event,
                type: extractedMessage.type,
                hasText: extractedMessage.hasText,
                textLength: extractedMessage.text?.length,
                from: extractedMessage.from,
                metadata: {
                    hasLink: !!extractedMessage.matchedText,
                    hasMedia: !!extractedMessage.mediaUrl,
                    messageId: extractedMessage.messageId
                }
            });

            return extractedMessage;
        } catch (error) {
            console.error('[Webhook] Erro ao extrair mensagem:', error);
            throw error;
        }
    }

    _extractMessageText(messageData) {
        const text = messageData.conversation ||
                    messageData.extendedTextMessage?.text ||
                    messageData.imageMessage?.caption ||
                    messageData.videoMessage?.caption;

        // Extrai informações de links se presentes
        const linkInfo = messageData.extendedTextMessage || {};
        
        return {
            text,
            hasText: !!text,
            matchedText: linkInfo.matchedText,
            canonicalUrl: linkInfo.canonicalUrl,
            description: linkInfo.description,
            title: linkInfo.title,
            previewType: linkInfo.previewType,
            jpegThumbnail: linkInfo.jpegThumbnail
        };
    }

    _extractMessageMetadata(messageContent) {
        return {
            messageId: messageContent?.key?.id,
            from: messageContent?.key?.remoteJid?.replace('@s.whatsapp.net', ''),
            pushName: messageContent?.pushName,
            isGroup: messageContent?.key?.remoteJid?.includes('@g.us') || false,
            timestamp: messageContent?.messageTimestamp,
            device: messageContent?.device
        };
    }

    _getBaseMessageType(originalType) {
        if (originalType === 'conversation' || originalType === 'extendedTextMessage' || originalType === 'text') {
            return 'text';
        }
        return originalType.replace('Message', '');
    }

    _addTypeSpecificData(message, messageData, messageType) {
        switch (message.type) {
            case 'audio':
                const audioMessage = messageData.audioMessage;
                if (audioMessage) {
                    message.mediaData = {
                        url: audioMessage.url,
                        mimetype: audioMessage.mimetype,
                        seconds: audioMessage.seconds,
                        ptt: audioMessage.ptt,
                        mediaKey: audioMessage.mediaKey,
                        fileEncSha256: audioMessage.fileEncSha256,
                        fileSha256: audioMessage.fileSha256,
                        fileLength: audioMessage.fileLength
                    };
                }
                break;

            case 'image':
                const imageMessage = messageData.imageMessage;
                if (imageMessage) {
                    message.mediaData = {
                        url: imageMessage.url,
                        mimetype: imageMessage.mimetype,
                        caption: imageMessage.caption,
                        mediaKey: imageMessage.mediaKey,
                        fileEncSha256: imageMessage.fileEncSha256,
                        fileSha256: imageMessage.fileSha256,
                        fileLength: imageMessage.fileLength,
                        jpegThumbnail: imageMessage.jpegThumbnail
                    };
                    message.hasImage = true;
                }
                break;

            case 'document':
                const documentMessage = messageData.documentMessage;
                if (documentMessage) {
                    message.mediaData = {
                        url: documentMessage.url,
                        mimetype: documentMessage.mimetype,
                        title: documentMessage.title,
                        fileSha256: documentMessage.fileSha256,
                        fileLength: documentMessage.fileLength,
                        mediaKey: documentMessage.mediaKey,
                        fileName: documentMessage.fileName
                    };
                }
                break;
        }

        return message;
    }

    async processWhatsAppImage(webhookData) {
        try {
            const { key, messageTimestamp } = webhookData;
            const imageMessage = webhookData.message?.imageMessage;

            if (!imageMessage) {
                throw new Error('Mensagem de imagem inválida ou ausente');
            }

            console.log('[WhatsApp] Processando imagem:', {
                messageId: key?.id,
                from: key?.remoteJid,
                timestamp: messageTimestamp,
                mimetype: imageMessage.mimetype,
                size: imageMessage.fileLength,
                caption: imageMessage.caption || 'Sem legenda'
            });

            // Criar objeto de mensagem para processamento
            const messageInfo = {
                mediaData: {
                    message: imageMessage,
                    messageType: 'image',
                    caption: imageMessage.caption
                }
            };

            // Processar imagem usando ImageService
            const imageService = new ImageService(this.groqServices);
            const result = await imageService.processWhatsAppImage(messageInfo);

            if (!result.success) {
                console.warn('[WhatsApp] Falha ao processar imagem:', {
                    error: result.error,
                    messageId: key?.id
                });

                // Enviar mensagem de erro para o usuário
                if (key?.remoteJid) {
                    await this.sendMessage(key.remoteJid, result.message);
                }

                return result;
            }

            return {
                success: true,
                analysis: result.analysis,
                metadata: {
                    messageId: key?.id,
                    from: key?.remoteJid,
                    timestamp: messageTimestamp,
                    type: 'image',
                    ...result.metadata
                }
            };

        } catch (error) {
            console.error('[WhatsApp] Erro ao processar imagem:', {
                error: error.message,
                stack: error.stack,
                messageId: webhookData.key?.id,
                from: webhookData.key?.remoteJid
            });

            // Enviar mensagem de erro para o usuário
            if (webhookData.key?.remoteJid) {
                await this.sendMessage(
                    webhookData.key.remoteJid,
                    'Desculpe, ocorreu um erro ao processar sua imagem. Por favor, tente enviar novamente.'
                );
            }

            return {
                success: false,
                message: 'Erro interno ao processar imagem',
                error: error.message
            };
        }
    }

    async processWhatsAppAudio(messageInfo) {
        try {
            console.log('[Audio] Iniciando processamento:', {
                hasMediaData: !!messageInfo?.mediaData,
                messageType: messageInfo?.mediaData?.messageType,
                hasMessage: !!messageInfo?.mediaData?.message,
                messageContent: messageInfo?.mediaData?.message
            });

            if (!messageInfo?.mediaData?.message) {
                throw new Error('Dados do áudio ausentes ou inválidos');
            }

            // Criar instância do AudioService
            const audioService = new AudioService(this.groqServices);
            
            // Processar o áudio com a estrutura correta
            const result = await audioService.processWhatsAppAudio(messageInfo);

            return {
                success: true,
                message: 'Áudio processado com sucesso',
                transcription: result
            };

        } catch (error) {
            console.error('[Audio] Erro ao processar áudio:', {
                message: error.message,
                stack: error.stack,
                mediaData: messageInfo?.mediaData
            });

            return {
                success: false,
                message: 'Não foi possível processar o áudio. Por favor, tente novamente.'
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

            // Extrai a mensagem do webhook
            const extractedMessage = await this.extractMessageFromWebhook(message);
            if (!extractedMessage) {
                console.warn(' Mensagem não reconhecida:', message);
                return;
            }

            console.log(' Mensagem extraída:', {
                type: extractedMessage.type,
                from: extractedMessage.from,
                hasText: extractedMessage.hasText,
                hasImage: extractedMessage.hasImage,
                messageLength: extractedMessage.text?.length
            });

            // Processa mensagem de mídia (imagem/áudio)
            if (extractedMessage.type === 'image' || extractedMessage.type === 'audio') {
                const mediaResult = await this.handleMediaMessage(message);
                if (mediaResult?.mediaHandled) {
                    return mediaResult;
                }
            }

            // Processa mensagem de texto
            if (extractedMessage.hasText && extractedMessage.text) {
                return {
                    text: extractedMessage.text,
                    type: 'text'
                };
            }

            // Mensagem não reconhecida
            console.warn(' Tipo de mensagem não suportado:', extractedMessage.type);
            return {
                text: "Desculpe, não consegui processar este tipo de mensagem. Por favor, envie texto, imagem ou áudio.",
                type: 'text'
            };

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
            } else if (message.message.audioMessage) {
                console.log('[Media] Processando mensagem de áudio:', {
                    hasMessage: !!message.message,
                    hasAudioMessage: !!message.message.audioMessage,
                    audioFields: message.message.audioMessage ? Object.keys(message.message.audioMessage) : []
                });

                // Verifica se tem os campos necessários
                const audioMessage = message.message.audioMessage;
                if (!audioMessage) {
                    console.error('[Media] Mensagem de áudio inválida');
                    return {
                        text: "Desculpe, não consegui processar seu áudio. Por favor, tente gravar novamente.",
                        mediaHandled: false
                    };
                }

                // Tenta transcrever o áudio
                try {
                    const result = await this.groqServices.processWhatsAppAudio(message);
                    return {
                        text: result ? `Transcrição do áudio: "${result}"` : "Não foi possível transcrever o áudio.",
                        mediaHandled: true
                    };
                } catch (transcriptionError) {
                    console.error('[Media] Erro na transcrição:', transcriptionError);
                    return {
                        text: "Desculpe, houve um problema ao transcrever seu áudio. Por favor, tente novamente ou digite sua mensagem.",
                        mediaHandled: false
                    };
                }
            }

            // Se não for nenhum tipo específico, retorna null para processamento padrão
            return null;
        } catch (error) {
            console.error('[Media] Erro ao processar mídia:', error);
            return {
                text: "Desculpe, ocorreu um erro ao processar sua mídia. Por favor, tente novamente.",
                mediaHandled: false
            };
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
