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

            // Extrai conteúdo baseado no tipo
            if (webhookData.body.message.conversation) {
                messageData.text = webhookData.body.message.conversation;
            } else if (webhookData.body.text) {
                messageData.text = webhookData.body.text;
            }

            // Adiciona dados da imagem se presente
            if (webhookData.body.message?.imageMessage) {
                messageData.imageMessage = webhookData.body.message.imageMessage;
            }

            console.log('[Webhook] Mensagem extraída:', {
                type: messageData.type,
                from: messageData.from,
                messageId: messageData.messageId,
                hasText: !!messageData.text,
                hasImage: !!messageData.imageMessage
            });

            return messageData;
        } catch (error) {
            console.error('[Webhook] Erro ao extrair mensagem:', error);
            return null;
        }
    }

    getMessageType(messageBody) {
        if (messageBody.message?.conversation || messageBody.text) {
            return 'text';
        }
        if (messageBody.message?.imageMessage) {
            return 'image';
        }
        if (messageBody.message?.audioMessage) {
            return {
                type: 'audio',
                audioMessage: messageBody.message.audioMessage
            };
        }
        if (messageBody.message?.documentMessage) {
            return 'document';
        }
        return null;
    }
}

module.exports = { WebhookService };
