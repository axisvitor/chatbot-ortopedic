const { WHATSAPP_CONFIG } = require('../config/settings');
const httpClient = require('../utils/http-client');
const { URL } = require('url');

class WhatsAppService {
    constructor() {
        this.config = WHATSAPP_CONFIG;
        this.financialDeptNumber = process.env.FINANCIAL_DEPT_NUMBER;
        this.httpClient = httpClient;
        
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
            console.log('📥 Webhook recebido (stringify):', JSON.stringify(body, null, 2));
            console.log('📥 Estrutura do body:', {
                hasBody: !!body,
                hasBodyBody: !!body?.body,
                hasMessage: !!body?.body?.message,
                hasKey: !!body?.body?.key,
                hasRemoteJid: !!body?.body?.key?.remoteJid
            });
            
            if (!body || !body.body || !body.body.message || !body.body.key) {
                throw new Error('Invalid webhook format');
            }

            const { message, key } = body.body;
            console.log('🔑 Key do webhook:', key);
            console.log('💬 Message do webhook:', message);

            const text = message.extendedTextMessage?.text || message.conversation || '';
            const remoteJid = key.remoteJid;
            
            console.log('🔄 Processando remoteJid:', {
                original: remoteJid,
                tipo: typeof remoteJid,
                tamanho: remoteJid?.length,
                temSufixo: remoteJid?.includes('@s.whatsapp.net')
            });

            // Garante que temos um número válido
            if (!remoteJid) {
                throw new Error('RemoteJid não encontrado no webhook');
            }

            // Remove o sufixo do WhatsApp e qualquer caractere não numérico
            const from = remoteJid
                .replace('@s.whatsapp.net', '')  // Remove sufixo do WhatsApp
                .replace(/\D/g, '');             // Remove caracteres não numéricos
            
            if (!from) {
                throw new Error('Número do remetente inválido após processamento');
            }

            // Adiciona o código do país se não estiver presente
            const formattedNumber = from.startsWith('55') ? from : `55${from}`;
            
            console.log('📱 Dados do remetente processados:', {
                original: remoteJid,
                semSufixo: remoteJid.replace('@s.whatsapp.net', ''),
                somenteNumeros: from,
                formatado: formattedNumber,
                tamanhos: {
                    original: remoteJid.length,
                    semSufixo: remoteJid.replace('@s.whatsapp.net', '').length,
                    somenteNumeros: from.length,
                    formatado: formattedNumber.length
                }
            });

            let type = 'text';
            let content = text;
            let mediaUrl = null;

            // Verifica se é uma mensagem de áudio
            if (message.audioMessage) {
                type = 'audio';
                console.log('🎵 Dados do áudio recebidos:', message.audioMessage);
                
                try {
                    const audioBuffer = await this.downloadMedia(
                        message.audioMessage.url,
                        message.audioMessage.mediaKey,
                        message.audioMessage.fileEncSha256
                    );
                    
                    mediaUrl = {
                        ...message.audioMessage,
                        buffer: audioBuffer
                    };
                    
                    console.log('🎵 Áudio processado:', {
                        tipo: type,
                        remetente: formattedNumber,
                        mimetype: message.audioMessage.mimetype,
                        temBuffer: !!audioBuffer
                    });
                } catch (error) {
                    console.error('❌ Erro ao baixar áudio:', error);
                    throw new Error('Falha ao baixar o áudio');
                }
            }
            // Verifica se é uma imagem
            else if (message.imageMessage) {
                type = 'image';
                mediaUrl = message.imageMessage.url;
                console.log('🖼️ Imagem detectada:', mediaUrl);
            }
            // Verifica se é um documento
            else if (message.documentMessage) {
                type = 'document';
                mediaUrl = message.documentMessage.url;
                console.log('📄 Documento detectado:', mediaUrl);
            }

            const extractedMessage = {
                type,
                text: content,
                from: formattedNumber,
                messageId: key.id,
                audioUrl: type === 'audio' ? mediaUrl : undefined,
                imageUrl: type === 'image' ? mediaUrl : undefined,
                documentUrl: type === 'document' ? mediaUrl : undefined
            };

            console.log('📨 Mensagem extraída:', {
                ...extractedMessage,
                temNumero: !!extractedMessage.from,
                tamanhoNumero: extractedMessage.from?.length,
                tipoMensagem: type
            });

            return extractedMessage;
        } catch (error) {
            console.error('❌ Erro ao extrair mensagem do webhook:', error);
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
