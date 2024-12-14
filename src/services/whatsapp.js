const { WHATSAPP_CONFIG } = require('../config/settings');
const httpClient = require('../utils/http-client');
const { URL } = require('url');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const businessHours = require('./business-hours');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { WHATSAPP_CONFIG, BUSINESS_HOURS } = require('../config/settings');
const groqServices = require('./groq-services'); // Import the Groq services

class WhatsAppService {
    constructor() {
        this.config = WHATSAPP_CONFIG;
        this.financialDeptNumber = process.env.FINANCIAL_DEPT_NUMBER;
        this.httpClient = httpClient;
        this.groqServices = groqServices; // Initialize the Groq services
        
        // Garantir que a URL base tenha o protocolo https://
        if (!this.config.apiUrl.startsWith('http://') && !this.config.apiUrl.startsWith('https://')) {
            this.config.apiUrl = `https://${this.config.apiUrl}`;
        }
    }

    async sendMessage(to, message) {
        try {
            console.log('📤 Preparando envio:', {
                para: to,
                tipo: typeof to,
                tamanho: to?.length,
                mensagem: message
            });

            // Remove caracteres não numéricos e garante o código do país
            const cleanedNumber = to.replace(/\D/g, '');
            const formattedNumber = cleanedNumber.startsWith('55') ? cleanedNumber : `55${cleanedNumber}`;

            console.log('📱 Número processado:', {
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

            console.log('📤 Corpo da requisição:', body);

            const url = new URL('message/send-text', this.config.apiUrl);
            url.searchParams.append('connectionKey', this.config.connectionKey);
            
            console.log('🌐 URL da requisição:', url.toString());
            console.log('🔑 Token:', this.config.token);

            const response = await this.httpClient.post(url.toString(), body, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.token}`
                }
            });

            console.log('✅ Mensagem enviada com sucesso:', response.data);
            
            return response.data;
        } catch (error) {
            console.error('❌ Erro ao enviar mensagem:', {
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
            console.log('🌐 URL da requisição:', url.toString());

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
            console.log('🌐 URL da requisição:', url.toString());

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
        
        return `🔔 *Novo Comprovante de Pagamento*\n\n` +
               `📅 Data: ${timestamp}\n` +
               `👤 Cliente: ${paymentInfo.customerName || 'Não identificado'}\n` +
               `📱 Telefone: ${paymentInfo.customerPhone || 'Não informado'}\n` +
               `💰 Valor: ${paymentInfo.amount || 'Não identificado'}\n` +
               `🏦 Banco: ${paymentInfo.bank || 'Não identificado'}\n` +
               `📝 Tipo: ${paymentInfo.paymentType || 'Não identificado'}\n\n` +
               `✍️ Análise do Comprovante:\n${paymentInfo.analysis || 'Sem análise disponível'}`;
    }

    async downloadMedia(mediaUrl, mediaKey, fileEncSha256) {
        try {
            console.log('📥 Baixando mídia do WhatsApp...');
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
            console.error('❌ Erro ao baixar mídia:', error);
            throw error;
        }
    }

    async extractMessageFromWebhook(body) {
        try {
            console.log('📥 Webhook recebido (raw):', body);
            console.log('📥 Estrutura do body:', {
                hasBody: !!body,
                hasBodyBody: !!body?.body,
                hasMessage: !!body?.body?.message,
                hasKey: !!body?.body?.key,
                hasRemoteJid: !!body?.body?.key?.remoteJid,
                hasAudioMessage: !!body?.body?.message?.audioMessage
            });
            
            if (!body || !body.body || !body.body.message || !body.body.key) {
                throw new Error('Invalid webhook format');
            }

            const { message, key } = body.body;
            console.log('🔑 Key do webhook:', key);
            console.log('💬 Message do webhook:', {
                hasText: !!message.extendedTextMessage || !!message.conversation,
                hasImage: !!message.imageMessage,
                hasAudio: !!message.audioMessage,
                audioDetails: message.audioMessage ? {
                    mediaKey: !!message.audioMessage.mediaKey,
                    url: !!message.audioMessage.url,
                    mimetype: message.audioMessage.mimetype
                } : null
            });

            // Processa o número do remetente
            const remoteJid = key.remoteJid;
            if (!remoteJid) {
                throw new Error('RemoteJid não encontrado no webhook');
            }

            // Remove o sufixo do WhatsApp e qualquer caractere não numérico
            const from = remoteJid
                .replace('@s.whatsapp.net', '')
                .replace(/\D/g, '');
            
            if (!from) {
                throw new Error('Número do remetente inválido após processamento');
            }

            // Adiciona o código do país se não estiver presente
            const formattedNumber = from.startsWith('55') ? from : `55${from}`;

            // Determina o tipo de mensagem e extrai o conteúdo
            let type = 'text';
            let content = {};

            if (message.imageMessage) {
                type = 'image';
                content.imageUrl = message.imageMessage;
            } else if (message.audioMessage) {
                type = 'audio';
                content.audioMessage = message.audioMessage;
            } else {
                content.text = message.extendedTextMessage?.text || message.conversation || '';
            }

            return {
                type,
                from: formattedNumber,
                messageId: key.id,
                ...content
            };
        } catch (error) {
            console.error('❌ Erro ao extrair mensagem do webhook:', error);
            throw error;
        }
    }

    async handleIncomingMessage(message) {
        try {
            const autoReply = businessHours.getAutoReplyMessage();
            if (autoReply) {
                await this.sendMessage(message.key.remoteJid, autoReply);
                return;
            }

            // Processar a mensagem normalmente
            const extractedMessage = this.extractMessageFromWebhook(message);
            if (!extractedMessage) {
                console.warn('⚠️ Mensagem não reconhecida:', message);
                return;
            }

            // Resto do código de processamento da mensagem...
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
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
            console.error('❌ Erro ao processar mídia:', error);
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
                console.log('🔍 Analisando imagem com Vision:', { url: imageUrl });
                const analysis = await this.groqServices.analyzeImage(imageUrl);
                
                // Se a análise contiver palavras-chave relacionadas a pagamento
                const analysisText = analysis.toLowerCase();
                const isPaymentProof = paymentKeywords.some(keyword => 
                    analysisText.includes(keyword)
                );

                console.log('✅ Análise Vision concluída:', {
                    isPaymentProof,
                    analysisExcerpt: analysis.substring(0, 100) + '...'
                });

                return isPaymentProof;
            }

            return false;
        } catch (error) {
            console.error('❌ Erro ao analisar imagem:', error);
            // Em caso de erro, assume que não é comprovante
            return false;
        }
    }

    async forwardPaymentProof(mediaData, userContact) {
        try {
            const config = BUSINESS_HOURS.departments.financial.paymentProofs;
            
            // Validar tipo de arquivo
            if (!config.allowedTypes.includes(mediaData.mimetype)) {
                throw new Error(`Tipo de arquivo não permitido: ${mediaData.mimetype}`);
            }

            // Validar tamanho
            if (mediaData.size > config.maxSize) {
                throw new Error(`Arquivo muito grande: ${mediaData.size} bytes`);
            }

            // Criar diretório se não existir
            await fs.mkdir(config.saveDir, { recursive: true });

            // Salvar arquivo localmente
            const extension = mediaData.mimetype.split('/')[1];
            const fileName = `payment_proof_${Date.now()}_${userContact.replace(/[^0-9]/g, '')}.${extension}`;
            const filePath = path.join(config.saveDir, fileName);
            
            await fs.writeFile(filePath, mediaData.buffer);

            // Analisar o comprovante com Vision
            const imageUrl = mediaData.url || `file://${filePath}`;
            const analysis = await this.groqServices.analyzeImage(imageUrl);

            // Estruturar dados do comprovante
            const proofData = {
                timestamp: new Date().toISOString(),
                userContact,
                mediaType: mediaData.mimetype,
                mediaSize: mediaData.size,
                filePath,
                fileName,
                analysis // Inclui a análise do Vision
            };

            // Log do encaminhamento
            console.log('💰 Comprovante processado:', {
                ...proofData,
                analysisExcerpt: analysis.substring(0, 100) + '...',
                buffer: '<<binary data>>'
            });

            // Enviar para webhook se configurado
            if (config.webhook) {
                const formData = new FormData();
                Object.entries(proofData).forEach(([key, value]) => {
                    formData.append(key, value);
                });
                formData.append('file', mediaData.buffer, fileName);

                await axios.post(config.webhook, formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`
                    }
                });

                console.log('📤 Comprovante enviado para webhook');
            }

            // Enviar resposta com detalhes da análise
            const responseMessage = `✅ Comprovante recebido e analisado:\n\n${analysis}\n\nO comprovante será verificado pelo setor financeiro. Posso ajudar com mais alguma coisa?`;
            await this.sendTextMessage(userContact, responseMessage);

            return true;
        } catch (error) {
            console.error('❌ Erro ao encaminhar comprovante:', error);
            throw error;
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
