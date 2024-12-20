class WhatsAppBase {
    constructor() {
        if (this.constructor === WhatsAppBase) {
            throw new Error('WhatsAppBase é uma classe abstrata e não pode ser instanciada diretamente');
        }
    }

    async initialize() {
        throw new Error('O método initialize deve ser implementado');
    }

    async sendMessage(to, message) {
        throw new Error('O método sendMessage deve ser implementado');
    }

    async sendImage(to, imageUrl, caption) {
        throw new Error('O método sendImage deve ser implementado');
    }

    async sendAudio(to, audioUrl) {
        throw new Error('O método sendAudio deve ser implementado');
    }

    async sendDocument(to, documentUrl, filename) {
        throw new Error('O método sendDocument deve ser implementado');
    }

    async markMessageAsRead(messageId) {
        throw new Error('O método markMessageAsRead deve ser implementado');
    }

    async getMessageById(messageId) {
        throw new Error('O método getMessageById deve ser implementado');
    }

    async validateMessage(message) {
        throw new Error('O método validateMessage deve ser implementado');
    }
}

module.exports = { WhatsAppBase }; 