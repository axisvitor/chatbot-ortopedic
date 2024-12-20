# Sistema de Armazenamento de Conversas para Fine-tuning

Este documento descreve o sistema implementado para armazenar e recuperar conversas do WhatsApp para posterior uso em fine-tuning do modelo.

## 1. Estrutura de Dados no Redis

### Chaves Principais
```
conversation:{numero_whatsapp}:{timestamp}  -> Mensagem individual
user_messages:{numero_whatsapp}            -> Lista de mensagens do usuário
all_conversations                          -> Lista global de todas as mensagens
```

### Tempo de Expiração
- Todas as mensagens expiram em 60 dias
- Configurado em: `this.CONVERSATION_EXPIRY = 60 * 24 * 60 * 60`
- Após este período, as mensagens são automaticamente removidas do Redis

## 2. Formato das Mensagens

Cada mensagem é armazenada no seguinte formato:
```json
{
    "role": "user" | "assistant",    // Quem enviou a mensagem
    "content": "string",             // Conteúdo da mensagem
    "timestamp": 1234567890,         // Momento do envio (milliseconds)
    "phoneNumber": "5511999999999"   // Número do WhatsApp
}
```

## 3. Principais Métodos

### Armazenar Mensagem
```javascript
await _storeMessage(from, role, content)
```
- Usado automaticamente em `processMessage()`
- Armazena tanto mensagens do usuário quanto respostas do assistente
- Atualiza as listas de mensagens do usuário e global

### Recuperar Histórico de Um Usuário
```javascript
await getUserConversationHistory(numeroWhatsApp)
```
- Retorna array de mensagens ordenadas por timestamp
- Útil para análise individual de conversas
- Inclui todas as mensagens não expiradas

### Recuperar Todas as Conversas
```javascript
await getAllConversationsForFineTuning()
```
- Retorna objeto com todas as conversas agrupadas por usuário
- Formato ideal para preparação de dados de fine-tuning
- Mantém a ordem cronológica das mensagens

## 4. Como Usar para Fine-tuning

### 1. Coletar Dados
```javascript
const allConversations = await aiServices.getAllConversationsForFineTuning();
```

### 2. Estrutura Retornada
```javascript
{
    "5511999999999": [
        {
            role: "user",
            content: "Mensagem do cliente",
            timestamp: 1234567890,
            phoneNumber: "5511999999999"
        },
        {
            role: "assistant",
            content: "Resposta do assistente",
            timestamp: 1234567891,
            phoneNumber: "5511999999999"
        }
        // ... mais mensagens
    ],
    // ... mais usuários
}
```

### 3. Processamento para Fine-tuning
```javascript
// Recuperar todas as conversas
const conversations = await aiServices.getAllConversationsForFineTuning();

// Processar para formato de fine-tuning
const trainingData = Object.values(conversations).map(userConversation => {
    return {
        messages: userConversation.map(msg => ({
            role: msg.role,
            content: msg.content
        }))
    };
});

// Agora trainingData está pronto para fine-tuning
```

## 5. Observações Importantes

### Armazenamento Automático
- As mensagens são armazenadas automaticamente durante o processamento normal
- Não é necessário chamar métodos adicionais para armazenar conversas

### Organização
- O sistema mantém tanto mensagens individuais quanto listas organizadas
- Facilita a recuperação por usuário ou global
- Mantém a ordem cronológica das conversas

### Performance
- Todas as operações são assíncronas (usar `async/await`)
- Sistema de cache Redis otimiza a performance
- Expiração automática evita sobrecarga do banco de dados

### Logs
- Sistema mantém logs detalhados para debug
- Registra tentativas de armazenamento e recuperação
- Facilita a identificação de problemas

## 6. Exemplos de Uso

### Recuperar Conversas de um Usuário Específico
```javascript
const userNumber = "5511999999999";
const history = await aiServices.getUserConversationHistory(userNumber);
console.log(`Total de mensagens: ${history.length}`);
```

### Exportar Todas as Conversas para JSON
```javascript
const allData = await aiServices.getAllConversationsForFineTuning();
const jsonData = JSON.stringify(allData, null, 2);
fs.writeFileSync('conversas_para_treino.json', jsonData);
```

### Análise de Conversas
```javascript
const conversations = await aiServices.getAllConversationsForFineTuning();
const totalUsers = Object.keys(conversations).length;
const totalMessages = Object.values(conversations)
    .reduce((sum, userMsgs) => sum + userMsgs.length, 0);

console.log(`Total de usuários: ${totalUsers}`);
console.log(`Total de mensagens: ${totalMessages}`);
```

## 7. Manutenção

### Limpeza Manual (se necessário)
```javascript
// Limpar todas as mensagens de um usuário
await redisStore.del(`user_messages:${phoneNumber}`);

// Limpar todas as conversas
await redisStore.del('all_conversations');
```

### Monitoramento
- Verificar regularmente o uso de memória do Redis
- Monitorar o volume de mensagens armazenadas
- Ajustar o tempo de expiração conforme necessário 