const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { Groq } = require("groq-sdk");
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './session'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-web-security'
        ]
    }
});

let botStatus = 'Iniciando...';
let qrCodeData = '';
let connectedAt = null;

const IPTV_CONTEXT = `
Você é um assistente especializado em vendas de IPTV. Informações do serviço:

🎯 SERVIÇO IPTV:
- Mais de 15.000 canais nacionais e internacionais
- Qualidade HD/4K/8K
- Funciona em Smart TV, celular, PC, tablet
- Filmes e séries atualizados
- Canais premium inclusos
- Suporte técnico 24h

📺 PLANOS DISPONÍVEIS:

🔹 PLANO 1 TELA:
• 1 mês: R$ 40,00
• 3 meses: R$ 105,00 (economize R$ 15)
• 6 meses: R$ 200,00 (economize R$ 40)
• 12 meses: R$ 380,00 (economize R$ 100)

🔹 PLANO 2 TELAS:
• 1 mês: R$ 70,00
• 3 meses: R$ 180,00 (economize R$ 30)
• 6 meses: R$ 330,00 (economize R$ 90)

💰 FORMAS DE PAGAMENTO:
- PIX
- Cartão de crédito
- Transferência bancária

⚡ ATIVAÇÃO:
- Teste grátis: 6 horas
- Ativação em até 30 minutos após pagamento
- Tutorial de instalação incluído

INSTRUÇÕES:
1. Seja sempre cordial e profissional
2. Destaque as economias dos planos maiores
3. Ofereça teste grátis para interessados
4. Explique diferença entre 1 e 2 telas
5. Para problemas técnicos, encaminhe para suporte humano
6. Mantenha respostas objetivas (máximo 4 linhas)
7. Use emojis para deixar mais atrativo

Responda sempre em português brasileiro.
`;

client.on('qr', (qr) => {
    console.log('📱 QR Code gerado - Escaneie com WhatsApp');
    qrCodeData = qr;
    qrcode.generate(qr, { small: true });
    botStatus = 'Aguardando QR Code';
});

client.on('ready', () => {
    console.log('✅ Bot WhatsApp conectado com sucesso!');
    botStatus = 'Online';
    connectedAt = new Date();
    qrCodeData = '';
});

client.on('authenticated', () => {
    console.log('🔐 WhatsApp autenticado');
    botStatus = 'Autenticado';
});

client.on('disconnected', (reason) => {
    console.log('❌ Bot desconectado:', reason);
    botStatus = 'Desconectado';
    connectedAt = null;
});

client.on('message', async (message) => {
    if (message.from.includes('@g.us') || message.fromMe) return;
    
    const userMessage = message.body.trim();
    const contact = await message.getContact();
    
    console.log(`📩 ${contact.name || contact.number}: ${userMessage}`);
    
    if (!userMessage) return;
    
    try {
        const escalationKeywords = [
            'não funciona', 'problema', 'travando', 'erro', 'bug',
            'cancelar', 'reembolso', 'reclamação', 'suporte técnico',
            'não carrega', 'lento', 'falha', 'defeito', 'ruim'
        ];
        
        const needsHuman = escalationKeywords.some(keyword => 
            userMessage.toLowerCase().includes(keyword)
        );
        
        if (needsHuman) {
            await message.reply(
                `🔧 *Suporte Técnico Especializado*\n\n` +
                `Identifiquei que você precisa de ajuda técnica.\n` +
                `Nossa equipe especializada entrará em contato em breve.\n\n` +
                `⏰ *Tempo médio de resposta:* 15 minutos\n` +
                `📞 *Horário de atendimento:* 24 horas`
            );
            
            await notifyOwner(contact.name || 'Sem nome', contact.number, userMessage);
            return;
        }
        
        const response = await groq.chat.completions.create({
            model: "llama3-8b-8192",
            messages: [
                { role: "system", content: IPTV_CONTEXT },
                { role: "user", content: userMessage }
            ],
            max_tokens: 300,
            temperature: 0.7
        });
        
        const botResponse = response.choices[0].message.content.trim();
        
        let finalResponse = botResponse;
        
        if (userMessage.toLowerCase().includes('preço') || 
            userMessage.toLowerCase().includes('valor') ||
            userMessage.toLowerCase().includes('quanto')) {
            finalResponse += `\n\n💬 *Quer fazer um teste grátis de 6h?*\nDigite "TESTE" para começar!`;
        }
        
        await message.reply(finalResponse);
        
    } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error);
        
        if (error.status === 402) {
            await message.reply(
                "⚠️ *Serviço Temporariamente Indisponível*\n\n" +
                "Estamos ajustando nosso sistema de atendimento automático.\n" +
                "Por favor, envie sua dúvida novamente em 10 minutos."
            );
        } else {
            await message.reply(
                `⚠️ *Erro Temporário*\n\n` +
                `Desculpe, tive um problema técnico momentâneo.\n` +
                `Nossa equipe foi notificada automaticamente.\n\n` +
                `🔄 Tente novamente em alguns segundos ou ` +
                `nossa equipe entrará em contato.`
            );
        }
        
        await notifyOwner(
            contact.name || 'Sem nome', 
            contact.number, 
            `❌ ERRO TÉCNICO: ${userMessage}\n\nErro: ${error.message}`
        );
    }
});

async function notifyOwner(customerName, customerNumber, message) {
    const ownerNumber = process.env.OWNER_PHONE;
    if (!ownerNumber) {
        console.log('⚠️ OWNER_PHONE não configurado');
        return;
    }
    
    const notification = 
        `🚨 *ATENDIMENTO NECESSÁRIO*\n\n` +
        `👤 *Cliente:* ${customerName}\n` +
        `📱 *Número:* ${customerNumber.replace('@c.us', '')}\n` +
        `💬 *Mensagem:*\n${message}\n\n` +
        `📅 *Data/Hora:* ${new Date().toLocaleString('pt-BR')}\n\n` +
        `⚡ *Responda para assumir o atendimento*`;
    
    try {
        await client.sendMessage(ownerNumber, notification);
        console.log('📤 Proprietário notificado');
    } catch (error) {
        console.error('❌ Erro ao notificar proprietário:', error);
    }
}

app.get('/', (req, res) => {
    res.json({
        service: 'WhatsApp IPTV Bot',
        ai_provider: 'Groq (Llama 3)',
        status: botStatus,
        connected_at: connectedAt,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

app.get('/qr', (req, res) => {
    if (qrCodeData) {
        res.json({
            qr_available: true,
            qr_code: qrCodeData,
            message: 'Escaneie o QR Code com seu WhatsApp',
            instructions: [
                '1. Abra o WhatsApp no seu celular',
                '2. Vá em Configurações > Aparelhos conectados',
                '3. Toque em "Conectar um aparelho"',
                '4. Escaneie o QR Code'
            ]
        });
    } else {
        res.json({
            qr_available: false,
            message: botStatus === 'Online' ? 'Bot já conectado' : 'QR Code não disponível',
            status: botStatus
        });
    }
});

app.get('/status', (req, res) => {
    res.json({
        status: botStatus,
        is_connected: botStatus === 'Online',
        connected_at: connectedAt,
        uptime_seconds: Math.floor(process.uptime()),
        memory_usage: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        bot_status: botStatus,
        ai_provider: 'Groq (Llama 3)',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🤖 IA: Groq (Llama 3 - Gratuito)`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`📱 QR Code: http://localhost:${PORT}/qr`);
});

console.log('🔄 Inicializando WhatsApp...');
client.initialize();

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});
