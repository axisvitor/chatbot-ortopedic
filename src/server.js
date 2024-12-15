require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { ChatbotController } = require('./main');

// Log de inicialização
console.log(' Iniciando servidor...', {
    nodeEnv: process.env.NODE_ENV,
    hasEnvVars: {
        openai: !!process.env.OPENAI_API_KEY,
        groq: !!process.env.GROQ_API_KEY,
        redis: !!process.env.REDIS_HOST,
        whatsapp: !!process.env.WAPI_URL
    }
});

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
let chatbot;
try {
    console.log(' Inicializando ChatbotController...');
    chatbot = new ChatbotController();
    console.log(' ChatbotController inicializado com sucesso');
} catch (error) {
    console.error(' Erro ao inicializar ChatbotController:', error);
    process.exit(1);
}

// Rota de healthcheck
app.get('/', (req, res) => {
    console.log(' Healthcheck solicitado');
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        servicesStatus: {
            chatbot: !!chatbot,
            redis: chatbot?.whatsappService?.redis?.status === 'ready'
        }
    });
});

// Handler de erros global
app.use((err, req, res, next) => {
    console.error(' Erro global:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Erro interno do servidor',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Rota para mensagens do WhatsApp
app.post('/webhook/msg_recebidas_ou_enviadas', async (req, res) => {
    try {
        const data = req.body;
        
        // Log dos dados brutos para debug
        console.log(' Dados brutos do webhook:', JSON.stringify(data, null, 2));
        
        // Se não houver dados, retorna erro
        if (!data) {
            console.error(' Webhook recebido sem dados');
            return res.status(400).json({ 
                success: false, 
                error: 'Dados não fornecidos' 
            });
        }

        // Log estruturado dos dados processados
        console.log(' Webhook recebido:', {
            event: data.event,
            messageId: data.messageId,
            from: data.sender?.pushName,
            hasText: !!data.messageText?.text,
            hasImage: !!data.jpegThumbnail,
            isGroup: data.isGroup,
            rawMessage: data.message || data.messageText, // adicionado para debug
            rawSender: data.sender || data.from // adicionado para debug
        });

        // Se for evento de mensagem recebida
        if (data.message || data.messageText) {
            const message = {
                type: data.messageText?.text ? 'text' : 
                      data.message?.text ? 'text' :
                      data.jpegThumbnail ? 'image' : 'unknown',
                text: data.messageText?.text || data.message?.text,
                imageUrl: data.jpegThumbnail,
                from: data.sender?.id || data.from,
                messageId: data.messageId || data.id,
                timestamp: data.moment || new Date().toISOString()
            };

            console.log(' Mensagem processada:', message);

            const response = await chatbot.processMessage(message);
            console.log(' Resposta gerada:', {
                length: response?.length,
                preview: response?.substring(0, 100)
            });

            res.json({ success: true, response });
        } 
        // Se for confirmação de mensagem enviada
        else if (data.event === 'messageSent') {
            console.log(' Mensagem enviada com sucesso:', {
                messageId: data.messageId,
                to: data.recipient?.id
            });
            res.json({ success: true });
        }
        else {
            console.log(' Evento não reconhecido:', data);
            res.json({ success: true });
        }

    } catch (error) {
        console.error(' Erro no webhook:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro interno do servidor',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Rota de teste para envio de mensagem
app.post('/test/send-message', async (req, res) => {
    try {
        const { to, message } = req.body;
        console.log(' Teste de envio:', { to, message });
        
        const whatsapp = new WhatsAppService();
        const response = await whatsapp.sendText(to, message);
        
        console.log(' Resposta do envio:', response);
        res.json({ success: true, response });
    } catch (error) {
        console.error(' Erro no teste:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Inicia o servidor
const PORT = process.env.PORT || 1988;

// Handler de erros não capturados
process.on('uncaughtException', (error) => {
    console.error(' Erro não capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(' Promise rejeitada não tratada:', reason);
    process.exit(1);
});

try {
    app.listen(PORT, () => {
        console.log(` Servidor rodando na porta ${PORT}`);
    });
} catch (error) {
    console.error(' Erro ao iniciar servidor:', error);
    process.exit(1);
}
