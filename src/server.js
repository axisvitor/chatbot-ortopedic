const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { ChatbotController } = require('./main');

// Inicializa Express
const app = express();

// Middlewares de segurança e otimização
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100 // limite por IP
});
app.use(limiter);

// Instancia o controlador
const chatbot = new ChatbotController();

// Rota de healthcheck
app.get('/', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rota para mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
    try {
        const message = req.body;
        console.log('📨 Webhook recebido:', {
            type: message.type,
            hasText: !!message.text,
            hasImage: !!message.imageMessage,
            hasAudio: !!message.audioMessage
        });

        const response = await chatbot.processMessage(message);
        res.json({ success: true, response });

    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro interno do servidor'
        });
    }
});

// Inicia o servidor
const PORT = process.env.PORT || 1988;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
