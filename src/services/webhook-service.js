class WebhookService {
    extractMessageFromWebhook(webhookData) {
        try {
            console.log('[Webhook] Processando dados:', {
                type: webhookData?.type,
                hasBody: !!webhookData?.body,
                hasMessage: !!webhookData?.body?.message
            });

            // Validações básicas
            if (!webhookData?.body?.key?.remoteJid || !webhookData?.body?.message) {
                console.log('[Webhook] Dados inválidos:', webhookData);
                return null;
            }

            // Extrai dados básicos
            const messageData = {
                type: this.getMessageType(webhookData.body),
                from: webhookData.body.key.remoteJid.replace('@s.whatsapp.net', ''),
                messageId: webhookData.body.key.id,
                timestamp: webhookData.body.messageTimestamp,
                pushName: webhookData.body.pushName,
                device: webhookData.body.device
            };

            // Extrai texto da mensagem
            const message = webhookData.body.message;
            messageData.text = message.conversation || 
                             message.extendedTextMessage?.text ||
                             message.imageMessage?.caption ||
                             message.documentMessage?.caption ||
                             null;

            // Adiciona dados da mídia se presente
            if (message.imageMessage) {
                messageData.imageMessage = message.imageMessage;
            }
            if (message.audioMessage) {
                messageData.audioMessage = message.audioMessage;
            }
            if (message.documentMessage) {
                messageData.documentMessage = message.documentMessage;
            }

            console.log('[Webhook] Mensagem extraída:', {
                type: messageData.type,
                from: messageData.from,
                messageId: messageData.messageId,
                hasText: !!messageData.text,
                textPreview: messageData.text?.substring(0, 100),
                hasImage: !!messageData.imageMessage,
                hasAudio: !!messageData.audioMessage,
                hasDocument: !!messageData.documentMessage
            });

            return messageData;
        } catch (error) {
            console.error('[Webhook] Erro ao extrair mensagem:', error);
            return null;
        }
    }

    getMessageType(messageBody) {
        const message = messageBody.message;
        if (!message) return null;

        // Verifica tipos de mensagem em ordem de prioridade
        if (message.conversation || message.extendedTextMessage?.text) {
            return 'text';
        }
        if (message.imageMessage) {
            return 'image';
        }
        if (message.audioMessage) {
            return 'audio';
        }
        if (message.documentMessage) {
            return 'document';
        }
        
        return null;
    }
}

module.exports = { WebhookService };
