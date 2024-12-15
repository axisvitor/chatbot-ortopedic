# Chatbot Ortopédico com IA

Um chatbot inteligente para atendimento de clientes de uma loja de calçados ortopédicos, com recursos de rastreamento de pedidos e processamento de pagamentos.

## Funcionalidades

- 🤖 Atendimento automatizado usando OpenAI GPT-4
- 🎤 Transcrição de áudio usando Groq
- 🖼️ Análise de imagens para comprovantes de pagamento
- 📦 Rastreamento de pedidos integrado com 17TRACK
- 💬 Integração com WhatsApp API
- 🕒 Controle de horário comercial
- 💾 Cache com Redis para melhor performance

## Tecnologias

- Node.js 20+
- Express.js
- OpenAI API (GPT-4)
- Groq API (Whisper e Vision)
- Redis
- WhatsApp API
- 17TRACK API

## Estrutura do Projeto

```
src/
├── config/
│   └── settings.js          # Configurações do projeto
├── services/
│   ├── ai-services.js       # Serviços de IA (OpenAI)
│   ├── audio-service.js     # Processamento de áudio
│   ├── groq-services.js     # Serviços Groq (áudio e imagem)
│   ├── image-service.js     # Processamento de imagens
│   ├── redis-store.js       # Cache Redis
│   ├── tracking.js          # Serviço de rastreamento
│   ├── webhook-service.js   # Processamento de webhooks
│   └── whatsapp.js         # Serviço do WhatsApp
├── utils/
│   └── image-validator.js   # Validação de imagens
└── server.js               # Servidor principal
```

## Configuração

1. Clone o repositório
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Configure as variáveis de ambiente no arquivo `.env`:
   ```env
   # OpenAI
   OPENAI_API_KEY=sua_chave
   ASSISTANT_ID=seu_assistant_id

   # Groq
   GROQ_API_KEY=sua_chave

   # Redis
   REDIS_HOST=seu_host
   REDIS_PORT=sua_porta
   REDIS_PASSWORD=sua_senha

   # WhatsApp
   WAPI_URL=sua_url
   WAPI_TOKEN=seu_token
   WAPI_CONNECTION_KEY=sua_chave

   # Outros
   NODE_ENV=production
   PORT=8080
   FINANCIAL_DEPT_NUMBER=numero_whatsapp
   ```

## Uso

Para iniciar o servidor:

```bash
npm start
```

O servidor estará rodando na porta especificada no .env (padrão: 8080).

## Endpoints

- `GET /` - Healthcheck
- `POST /webhook/msg_recebidas_ou_enviadas` - Webhook principal para mensagens do WhatsApp

## Recursos

### Processamento de Mensagens
- ✅ Texto: Processado pelo OpenAI Assistant
- ✅ Áudio: Transcrito pelo Groq Whisper e processado pelo Assistant
- ✅ Imagens: Analisadas pelo Groq Vision e processadas pelo Assistant

### Validações
- Formato e tamanho de arquivos
- Horário comercial
- Cache de contexto

### Logs e Monitoramento
- Logs detalhados de cada etapa
- Tratamento de erros específicos
- Métricas de uso

## Licença

Este projeto está licenciado sob a MIT License.
