// Adicione no topo do arquivo:
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;

// Reconstrua a URI:
const MONGODB_URI = `mongodb+srv://${DB_USER}:${DB_PASSWORD}@cluster0.xxxxx.mongodb.net/${DB_NAME}?retryWrites=true&w=majority`;

// Use assim:
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

// Configuração simplificada para o Render
const qrCodeGeneration = {
  toDataURL: async (qr) => {
    return `data:image/png;base64,${Buffer.from(qr).toString('base64')}`;
  }
};

// Configuração do MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  auth: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  },
  authSource: 'admin' // Geralmente é 'admin' no Atlas
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'Erro de conexão:'));
db.once('open', () => console.log('Conectado ao MongoDB'));

// Modelos
const UserSchema = new mongoose.Schema({
  phone: String,
  name: String,
  plan: String,
  expiry: Date,
  testExpiry: Date,
  testCredentials: {
    login: String,
    password: String
  }
});
const User = mongoose.model('User', UserSchema);

const TrialRequestSchema = new mongoose.Schema({
  phone: String,
  name: String,
  createdAt: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' }
});
const TrialRequest = mongoose.model('TrialRequest', TrialRequestSchema);

// Configuração do cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "iptv-bot",
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
      '--disable-gpu'
    ]
  }
});

let botStatus = 'Desconectado';
let connectedAt = null;
let qrCodeData = null;

// Configuração do Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

// Rotas
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Bot WhatsApp IPTV</h1>
    <p>Status: ${botStatus}</p>
    <p>Online desde: ${connectedAt || 'N/A'}</p>
    <p><a href="/dashboard">Dashboard Admin</a></p>
  `);
});

app.get('/dashboard', async (req, res) => {
  const requests = await TrialRequest.find().sort({ createdAt: -1 }).limit(10);
  
  let requestsHtml = '';
  requests.forEach(req => {
    requestsHtml += `<tr>
      <td>${req.phone}</td>
      <td>${req.name || 'N/A'}</td>
      <td>${req.createdAt.toLocaleString()}</td>
      <td>${req.status}</td>
    </tr>`;
  });
  
  res.send(`
    <h1>📊 Dashboard Admin</h1>
    
    <h2>Enviar Teste TV</h2>
    <form action="/send-trial" method="post">
      <input type="text" name="phone" placeholder="Número (5511999999999)" required>
      <button type="submit">Enviar Teste TV</button>
    </form>
    
    <h2>Últimas Solicitações de Teste</h2>
    <table border="1" style="width:100%">
      <tr>
        <th>Número</th>
        <th>Nome</th>
        <th>Data</th>
        <th>Status</th>
      </tr>
      ${requestsHtml}
    </table>
    
    <style>
      table { border-collapse: collapse; margin: 20px 0; }
      th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
      tr:hover { background-color: #f5f5f5; }
    </style>
  `);
});

app.post('/send-trial', async (req, res) => {
  const { phone } = req.body;
  try {
    await sendTrialCredentials(phone);
    res.send('✅ Credenciais de teste enviadas com sucesso!');
  } catch (error) {
    res.status(500).send('❌ Erro ao enviar credenciais: ' + error.message);
  }
});

// Função para enviar menu principal
async function sendMainMenu(chatId) {
  const menuMessage = `
*Olá, seja bem-vindo ao nosso atendimento virtual!* 👋

*Por favor, digite um número por vez para navegar pelo menu principal:*

0️⃣1️⃣ | *Como funciona?*
0️⃣2️⃣ | *Plano TV* 📺
0️⃣3️⃣ | *Plano Internet Ilimitada* 🛰️
0️⃣4️⃣ | *Forma de pagamento* 💰
0️⃣5️⃣ | *Perguntas frequentes* ⁉️
0️⃣6️⃣ | *Download de Apps* 🆓️
0️⃣7️⃣ | *Suporte* 🕵🏽‍♂️
0️⃣8️⃣ | *Aparelhos Compatíveis TV* ✅
#️⃣ | *Falar com um atendente* 👨🏻‍💻

*Visualiza nosso site*: 
abrela.me/promoiptv
  `;
  
  await client.sendMessage(chatId, menuMessage);
}

// Função para enviar credenciais de teste
async function sendTrialCredentials(phone) {
  // Gerar credenciais aleatórias
  const login = `teste${Math.floor(1000 + Math.random() * 9000)}`;
  const password = Math.random().toString(36).slice(2, 10);
  
  const message = `
⚡ *TESTE GRÁTIS TV* ⚡

Seu acesso de teste foi liberado!

📺 *Servidor:* premium-iptv.com
👤 *Usuário:* ${login}
🔑 *Senha:* ${password}
⏱️ *Validade:* 4 horas

📲 *App de instalação:*
https://abrela.me/digital+

Aproveite para testar nosso serviço! Qualquer dúvida, estamos à disposição.
  `;
  
  await client.sendMessage(`${phone}@c.us`, message);
  
  // Atualizar status no banco de dados
  await TrialRequest.findOneAndUpdate(
    { phone },
    { status: 'sent' },
    { new: true }
  );
}

// Handler de mensagens
client.on('message', async message => {
  // Ignorar mensagens do próprio bot
  if (message.fromMe) return;
  
  const phone = message.from.replace('@c.us', '');
  const body = message.body.trim().toLowerCase();
  
  // Comandos admin (apenas do número owner)
  if (message.from === process.env.OWNER_PHONE && body.startsWith('enviar teste')) {
    const targetPhone = body.split(' ')[2];
    if (targetPhone) {
      await sendTrialCredentials(targetPhone);
      await message.reply(`✅ Teste enviado para ${targetPhone}`);
    }
    return;
  }
  
  // Comando para solicitar teste TV
  if (body.includes('teste tv') || body.includes('quero teste tv')) {
    // Extrair nome da mensagem
    let name = 'Não informado';
    if (body.includes('teste tv')) {
      name = body.replace('teste tv', '').replace('quero', '').trim();
    }
    
    // Registrar solicitação
    await TrialRequest.create({ phone, name });
    
    await message.reply(`
✅ *Solicitação de teste registrada!*
Aguarde enquanto preparamos seu acesso. Você receberá as credenciais em instantes.
    `);
    
    // Enviar notificação para o admin
    if (process.env.OWNER_PHONE) {
      await client.sendMessage(
        process.env.OWNER_PHONE,
        `⚠️ *NOVA SOLICITAÇÃO DE TESTE TV* ⚠️\n\n` +
        `Cliente: ${name}\n` +
        `Número: ${phone}\n\n` +
        `Para enviar as credenciais, digite:\n` +
        `"enviar teste ${phone}"`
      );
    }
    
    return;
  }
  
  // Respostas do menu
  const menuResponses = {
    '01': `*COMO FUNCIONA?* 🤔\n\n` +
          `Nosso serviço de TV oferece:\n` +
          `- 📺 +15.000 canais HD/4K\n` +
          `- 🎬 Filmes e séries atualizados\n` +
          `- ⚡ Funcionamento 24h\n` +
          `- 📱 Suporte em todos os dispositivos\n\n` +
          `*PLANO INTERNET ILIMITADA* 🛰️:\n` +
          `- 🌐 Dados ilimitados no seu celular\n` +
          `- 🚫 Sem franquia de uso\n` +
          `- ⚡ Velocidade de até 5G (depende da cobertura)\n` +
          `- 📶 Funciona em qualquer operadora`,
    
    '02': `*PLANOS TV* 📺\n\n` +
          `🔥 *PLANO BÁSICO*:\n` +
          `- 1 tela: *R$ 40,00/mês*\n` +
          `- Canais essenciais\n\n` +
          `🔥 *PLANO PREMIUM*:\n` +
          `- 1 tela: *R$ 60,00/mês*\n` +
          `- Todos os canais + filmes\n\n` +
          `💡 *PROMOÇÃO*:\n` +
          `- 3 meses: *R$ 150,00* (economize R$ 30)\n` +
          `- 6 meses: *R$ 280,00* (economize R$ 80)\n\n` +
          `Para testar nosso serviço, digite *TESTE TV*`,
    
    '03': `*PLANO INTERNET ILIMITADA* 🛰️\n\n` +
          `🌐 *PLANO MENSAL*:\n` +
          `- *R$ 25,00/mês*\n` +
          `- Dados ilimitados\n` +
          `- Velocidade média de 10 Mbps\n\n` +
          `🌐 *PLANO TRIMESTRAL*:\n` +
          `- *R$ 65,00/3 meses* (economize R$ 10)\n\n` +
          `💡 *ATENÇÃO*:\n` +
          `- Funciona apenas em celulares Android\n` +
          `- Não é banda larga para residência`,
    
    '04': `*FORMAS DE PAGAMENTO* 💰\n\n` +
          `*Para pagar com PIX:*\n\n` +
          `Nome: Bruno Santos\n` +
          `Banco: PicPay\n\n` +
          `*Valores:*\n` +
          `- TV: R$ 40,00 (básico) ou R$ 60,00 (premium)\n` +
          `- Internet: R$ 25,00\n\n` +
          `*Chave PIX aleatória:*\n` +
          `e8f54c2a-4f0d-4b12-9b5b-7317dba8d1eb\n\n` +
          `⚠️ *OBS: Envie o comprovante para liberação!*\n` +
          `⚠️ *Sem comprovante não há liberação.*\n\n` +
          `Para ver a chave PIX novamente, digite *PIX*`,
    
    '05': `*PERGUNTAS FREQUENTES* ⁉️\n\n` +
          `1️⃣ *Posso usar o mesmo login em vários aparelhos?*\n` +
          `➡️ NÃO, logins são individuais.\n\n` +
          `2️⃣ *Diferença entre nosso acesso e operadoras tradicionais?*\n` +
          `➡️ Nas operadoras você paga por mega. Aqui é ilimitado por valor fixo.\n\n` +
          `3️⃣ *Posso compartilhar minha internet?*\n` +
          `➡️ NÃO, planos são individuais. Para mais aparelhos, contrate planos adicionais.\n\n` +
          `4️⃣ *Formas de pagamento?*\n` +
          `➡️ PIX, transferência ou boleto.\n\n` +
          `5️⃣ *Como solicitar suporte?*\n` +
          `➡️ Informe: canal, qualidade, filme/série, capítulo/episódio, servidor e problema.\n\n` +
          `6️⃣ *Tem fidelidade?*\n` +
          `➡️ NÃO, pode cancelar quando quiser.\n\n` +
          `7️⃣ *Vendem internet banda larga?*\n` +
          `➡️ NÃO, apenas para celular Android.\n\n` +
          `⚠️ *Após pagamento não há reembolso. Faça teste antes!*`,
    
    '06': `*DOWNLOAD DE APPS* 🆓️\n\n` +
          `*Atenção: Não instalamos pela Play Store.*\n\n` +
          `📱 *Para Android:*\n` +
          `1. Abra o Chrome\n` +
          `2. Acesse: https://abrela.me/digital+\n` +
          `3. Baixe e instale o app\n\n` +
          `📺 *Para Smart TV:*\n` +
          `- LG: Loja de apps > Buscar > iboplayer\n` +
          `- Samsung: Loja de apps > Buscar > iboplayer\n` +
          `(custo adicional de R$20,00/ano)\n\n` +
          `*Após instalar, digite TESTE TV para receber acesso.*`,
    
    '07': `*SUPORTE* 🕵🏽‍♂️\n\n` +
          `*Problemas comuns:*\n\n` +
          `1️⃣ *TV travando?*\n` +
          `➡️ Desligue roteador e aparelho por 5 minutos.\n\n` +
          `2️⃣ *Canal/filme não funciona?*\n` +
          `➡️ Mude a qualidade (SD/HD/FHD) ou informe:\n` +
          `   - Nome do canal/filme\n` +
          `   - Episódio/capítulo\n` +
          `   - Servidor usado\n` +
          `   - Imagem/vídeo do erro\n\n` +
          `3️⃣ *Acesso não funciona?*\n` +
          `➡️ Verifique vencimento do plano.`,
    
    '08': `*APARELHOS COMPATÍVEIS* ✅\n\n` +
          `- Computador: ✅\n` +
          `- iPhone/iPad: ✅\n` +
          `- Smart TV LG: ✅\n` +
          `- Smart TV Samsung (Tizen 2018+): ✅ (custo adicional R$20/ano)\n` +
          `- Android (celular/tablet): ✅\n` +
          `- TV Box: ✅\n` +
          `- Fire Stick: ✅\n` +
          `- Smart TV TCL: ✅\n` +
          `- Xbox/PS4: ✅\n\n` +
          `⚠️ *Smart TVs: custo adicional de R$20,00/ano (app iboplayer)*`,
    
    '#': `👨‍💼 *ATENDIMENTO HUMANO* 👨‍💼\n\n` +
         `Você será atendido por nosso especialista em breve.\n\n` +
         `⏱️ Aguarde alguns instantes...`
  };
  
  // Tratamento para números com e sem emojis
  const normalizedInput = body
    .replace(/[️⃣]/g, '') // Remove emojis de número
    .replace(/\D/g, '')   // Mantém apenas dígitos
    .slice(0, 2);         // Pega os dois primeiros dígitos

  if (menuResponses[normalizedInput]) {
    await message.reply(menuResponses[normalizedInput]);
    
    // Se não for a opção de atendente, enviar menu principal novamente
    if (normalizedInput !== '#') {
      await sendMainMenu(message.from);
    } else if (process.env.OWNER_PHONE) {
      // Notificar o admin sobre solicitação de atendente
      await client.sendMessage(
        process.env.OWNER_PHONE,
        `⚠️ *SOLICITAÇÃO DE ATENDENTE HUMANO* ⚠️\n\n` +
        `Cliente: ${phone}\n` +
        `Por favor, entre em contato!`
      );
    }
    return;
  }
  
  // Resposta para PIX
  if (body === 'pix') {
    await message.reply(menuResponses['04']);
    await sendMainMenu(message.from);
    return;
  }
  
  // Se não for um comando conhecido, enviar menu principal
  await sendMainMenu(message.from);
});

// Eventos do WhatsApp
client.on('qr', qr => {
  qrCodeData = qr;
  botStatus = 'Aguardando leitura do QR Code';
  console.log('QR Code recebido');
});

client.on('authenticated', () => {
  botStatus = 'Autenticado';
  console.log('Autenticado');
});

client.on('ready', () => {
  botStatus = 'Conectado';
  connectedAt = new Date();
  console.log('Cliente pronto!');
});

client.on('disconnected', (reason) => {
  botStatus = 'Desconectado';
  console.log('Cliente desconectado!', reason);
});

// Inicializar WhatsApp client
client.initialize();

// Inicializar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
});

