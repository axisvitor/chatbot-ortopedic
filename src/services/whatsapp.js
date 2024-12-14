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
            console.log('[Webhook] Dados recebidos:', {
                type: webhookData?.type,
                hasBody: !!webhookData?.body,
                messageType: this._getMessageType(webhookData?.body)
            });

            if (!webhookData?.body) {
                return null;
            }

            const messageTypes = this._getMessageTypes(webhookData.body);
            console.log('[MessageType] Tipos encontrados:', messageTypes);

            // Se não houver tipos de mensagem, retorna null
            if (!messageTypes.length) {
                return null;
            }

            const messageType = messageTypes[0];
            const messageContent = webhookData.body;

            let extractedMessage = {
                type: messageType,
                from: messageContent?.key?.remoteJid?.replace('@s.whatsapp.net', ''),
                messageId: messageContent?.key?.id
            };

            switch (messageType) {
                case 'audioMessage':
                    const audioMessage = messageContent?.message?.audioMessage;
                    console.log('[Webhook] Áudio processado:', {
                        mimetype: audioMessage?.mimetype,
                        hasMediaKey: !!audioMessage?.mediaKey,
                        isPtt: audioMessage?.ptt,
                        hasUrl: !!audioMessage?.url,
                        type: 'audio'
                    });

                    if (!audioMessage) {
                        throw new Error('Dados do áudio ausentes');
                    }

                    // Extrair dados do áudio
                    extractedMessage = {
                        ...extractedMessage,
                        type: 'audio',
                        audioMessage: {
                            url: audioMessage.url,
                            mimetype: audioMessage.mimetype,
                            seconds: audioMessage.seconds,
                            ptt: audioMessage.ptt,
                            mediaKey: audioMessage.mediaKey,
                            fileEncSha256: audioMessage.fileEncSha256
                        }
                    };

                    // Se tiver msgContent em base64, adiciona ao audioMessage
                    if (messageContent?.msgContent) {
                        const base64Data = messageContent.msgContent.split('base64,')[1];
                        if (base64Data) {
                            extractedMessage.audioMessage.buffer = Buffer.from(base64Data, 'base64');
                        }
                    }
                    break;

                case 'imageMessage':
                    const imageMessage = messageContent?.message?.imageMessage;
                    extractedMessage = {
                        ...extractedMessage,
                        type: 'image',
                        imageUrl: imageMessage?.url
                    };
                    break;

                case 'conversation':
                case 'extendedTextMessage':
                    extractedMessage = {
                        ...extractedMessage,
                        type: 'text',
                        text: messageContent?.message?.conversation || 
                              messageContent?.message?.extendedTextMessage?.text
                    };
                    break;

                case 'documentMessage':
                    extractedMessage = {
                        ...extractedMessage,
                        type: 'document',
                        documentUrl: messageContent?.message?.documentMessage?.url
                    };
                    break;
            }

            return extractedMessage;
        } catch (error) {
            console.error('[Webhook] Erro ao extrair mensagem:', error);
            throw error;
        }
    }

    _getMessageTypes(messageData) {
        const types = [];
        const message = messageData?.message;

        if (!message) return types;

        // Verifica cada tipo possível de mensagem
        if (message.audioMessage) types.push('audioMessage');
        if (message.imageMessage) types.push('imageMessage');
        if (message.conversation) types.push('conversation');
        if (message.extendedTextMessage) types.push('extendedTextMessage');
        if (message.documentMessage) types.push('documentMessage');

        return types;
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

            // Salvar a imagem temporariamente
            const tempDir = path.join(__dirname, '../../temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempImagePath = path.join(tempDir, `payment_${Date.now()}.jpg`);
            await fs.promises.writeFile(tempImagePath, buffer);

            console.log('[Image] Imagem salva temporariamente:', tempImagePath);

            // Se for um comprovante de pagamento
            if (this.isPaymentProof(messageInfo)) {
                console.log('[Image] Detectado como comprovante de pagamento');
                try {
                    // Analisar a imagem com Groq
                    const analysis = await this.groqServices.analyzeImage(tempImagePath);
                    console.log('[Image] Análise do comprovante:', analysis);

                    // Encaminhar para o setor financeiro
                    await this.forwardPaymentProof({
                        ...messageInfo.mediaData,
                        buffer,
                        analysis
                    }, messageInfo.from);

                    // Limpar arquivo temporário
                    try {
                        await fs.promises.unlink(tempImagePath);
                        console.log('[Image] Arquivo temporário removido:', tempImagePath);
                    } catch (cleanupError) {
                        console.error('[Image] Erro ao remover arquivo temporário:', cleanupError);
                    }

                    return {
                        success: true,
                        message: 'Comprovante recebido e analisado com sucesso',
                        analysis
                    };
                } catch (analysisError) {
                    console.error('[Image] Erro ao analisar comprovante:', analysisError);
                    return {
                        success: false,
                        message: 'Desculpe, não foi possível analisar o comprovante no momento. Por favor, tente novamente em alguns instantes.'
                    };
                }
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

    async processWhatsAppAudio(messageInfo) {
        try {
            console.log('[Audio] Iniciando processamento:', {
                hasMediaData: !!messageInfo?.mediaData,
                messageType: messageInfo?.mediaData?.messageType,
                hasMessage: !!messageInfo?.mediaData?.message
            });

            if (!messageInfo?.mediaData?.message) {
                throw new Error('Dados do áudio ausentes ou inválidos');
            }

            // Download do áudio usando Baileys
            console.log('[Audio] Iniciando download com Baileys');
            const stream = await downloadContentFromMessage(messageInfo.mediaData.message, 'audio');
            
            if (!stream) {
                console.error('[Audio] Stream não gerado pelo Baileys');
                throw new Error('Não foi possível iniciar o download do áudio');
            }

            // Converter stream em buffer
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            if (!buffer.length) {
                console.error('[Audio] Buffer vazio após download');
                throw new Error('Download do áudio falhou');
            }

            console.log('[Audio] Download concluído:', {
                tamanhoBuffer: buffer.length,
                primeirosBytes: buffer.slice(0, 16).toString('hex')
            });

            // Criar instância do AudioService
            const audioService = new AudioService(this.groqServices);
            
            // Preparar a mensagem no formato correto
            const audioData = {
                message: {
                    audioMessage: {
                        ...messageInfo.mediaData.message,
                        buffer: buffer, // Incluir o buffer baixado
                        mimetype: messageInfo.mediaData.mimetype,
                        fileLength: messageInfo.mediaData.fileLength,
                        seconds: messageInfo.mediaData.seconds,
                        ptt: messageInfo.mediaData.ptt,
                        mediaKey: messageInfo.mediaData.mediaKey,
                        fileEncSha256: messageInfo.mediaData.fileEncSha256,
                        fileSha256: messageInfo.mediaData.fileSha256
                    }
                }
            };

            // Processar o áudio
            const result = await audioService.processWhatsAppAudio(audioData);

            return {
                success: true,
                message: 'Áudio processado com sucesso',
                transcription: result
            };

        } catch (error) {
            console.error('[Audio] Erro ao processar áudio:', {
                message: error.message,
                stack: error.stack
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
