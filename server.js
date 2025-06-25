// server.js
require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const mongoose = require('mongoose');

// --- Variáveis de Ambiente ---
// Buscando as variáveis do ambiente. Garanta que elas estão configuradas corretamente na sua plataforma (Render).
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;
// IMPORTANTE: Esta variável NÃO deve conter número de porta (ex: :27017)
let MONGODB_CLUSTER_ADDRESS = process.env.MONGODB_CLUSTER_ADDRESS;
const OWNER_PHONE = process.env.OWNER_PHONE; // Seu número para notificações (ex: 5511999999999)
const PORT = process.env.PORT || 3000;

// --- Validação Inicial ---
// Verifica se todas as variáveis essenciais foram definidas.
if (!DB_USER || !DB_PASSWORD || !DB_NAME || !MONGODB_CLUSTER_ADDRESS || !OWNER_PHONE) {
  console.error('ERRO CRÍTICO: Variáveis de ambiente essenciais não foram definidas. Verifique seu arquivo .env ou as configurações de ambiente da hospedagem.');
  process.exit(1); // Encerra a aplicação se faltar configuração.
}

// --- Correção e Construção da URI do MongoDB ---
// Remove a porta do endereço do cluster, caso tenha sido adicionada por engano.
if (MONGODB_CLUSTER_ADDRESS.includes(':')) {
  console.warn('AVISO: O MONGODB_CLUSTER_ADDRESS continha uma porta, que foi removida automaticamente.');
  MONGODB_CLUSTER_ADDRESS = MONGODB_CLUSTER_ADDRESS.split(':')[0];
}
const MONGODB_URI = `mongodb+srv://${DB_USER}:${DB_PASSWORD}@${MONGODB_CLUSTER_ADDRESS}/${DB_NAME}?retryWrites=true&w=majority`;

// --- Conexão com o MongoDB ---
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Conectado ao MongoDB com sucesso!'))
  .catch(err => {
    console.error('FALHA INICIAL AO CONECTAR AO MONGODB:', err.message);
    // O erro "MongoParseError: mongodb+srv URI cannot have port number" aparecerá aqui se a URI estiver errada.
    process.exit(1);
  });

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'Erro de conexão com MongoDB (após conexão inicial):'));

// --- Definição dos Modelos (Schemas) do Banco de Dados ---
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

// --- Configuração do Cliente WhatsApp ---
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
      '--single-process', // A documentação do whatsapp-web.js sugere que isso pode ser desnecessário.
      '--disable-gpu'
    ]
  }
});

let botStatus = 'Desconectado';
let connectedAt = null;

// --- Configuração do Servidor Express ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rota de verificação de saúde para o Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Rota principal
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Bot WhatsApp IPTV</h1>
    <p>Status: ${botStatus}</p>
    <p>Online desde: ${connectedAt ? connectedAt.toLocaleString('pt-BR') : 'N/A'}</p>
    <p><a href="/dashboard">Dashboard Admin</a></p>
  `);
});

// --- Funções do Bot ---

/**
 * Envia uma mensagem com tratamento de erro.
 * @param {string} chatId ID do chat
 * @param {string} text Mensagem a ser enviada
 */
async function sendMessage(chatId, text) {
  try {
    await client.sendMessage(chatId, text);
  } catch (error) {
    console.error(`Erro ao enviar mensagem para ${chatId}:`, error);
  }
}

/**
 * Envia o menu principal para um chat.
 * @param {string} chatId ID do chat de destino
 */
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
  await sendMessage(chatId, menuMessage);
}

/**
 * Gera e envia credenciais de teste para um número de telefone.
 * @param {string} phone Número de telefone (sem @c.us)
 */
async function sendTrialCredentials(phone) {
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
  
  await sendMessage(`${phone}@c.us`, message);
  
  await TrialRequest.findOneAndUpdate(
    { phone },
    { status: 'sent', testCredentials: { login, password } },
    { new: true, upsert: true }
  );
  console.log(`Credenciais de teste enviadas e salvas para ${phone}`);
}

// --- Eventos do Cliente WhatsApp ---

client.on('qr', () => {
  botStatus = 'Aguardando leitura do QR Code';
  console.log('QR CODE GERADO. Por favor, escaneie para conectar.');
});

client.on('authenticated', () => {
  botStatus = 'Autenticado';
  console.log('Autenticação bem-sucedida!');
});

client.on('ready', () => {
  botStatus = 'Conectado e Pronto!';
  connectedAt = new Date();
  console.log('Cliente do WhatsApp está pronto!');
});

client.on('disconnected', (reason) => {
  botStatus = `Desconectado: ${reason}`;
  connectedAt = null;
  console.log('Cliente foi desconectado! Motivo:', reason);
  // Tenta reinicializar para reconectar automaticamente
  client.initialize();
});

client.on('auth_failure', (msg) => {
    console.error('FALHA DE AUTENTICAÇÃO:', msg);
    // Aqui você pode deletar a pasta de sessão para forçar a geração de um novo QR Code
});


// --- Manipulador Principal de Mensagens ---

client.on('message', async (message) => {
  // Ignora mensagens de status, de grupos ou do próprio bot
  if (message.from.endsWith('@g.us') || message.fromMe || !message.body) {
    return;
  }

  try {
    const phone = message.from.replace('@c.us', '');
    const body = message.body.trim().toLowerCase();

    // --- Comandos de Admin ---
    if (message.from === `${OWNER_PHONE}@c.us` && body.startsWith('enviar teste')) {
      const targetPhone = body.split(' ')[2];
      if (targetPhone && /^\d+$/.test(targetPhone)) {
        await sendMessage(message.from, `Enviando teste para ${targetPhone}...`);
        await sendTrialCredentials(targetPhone);
        await sendMessage(message.from, `✅ Teste enviado com sucesso para ${targetPhone}`);
      } else {
        await sendMessage(message.from, '❌ Formato inválido. Use: "enviar teste 5511999999999"');
      }
      return;
    }

    // --- Solicitação de Teste TV ---
    if (body.includes('teste tv') || body.includes('quero teste tv')) {
        const existingRequest = await TrialRequest.findOne({ phone, status: 'pending' });
        if (existingRequest) {
            await sendMessage(message.from, 'Você já possui uma solicitação de teste pendente. Por favor, aguarde.');
            return;
        }

        const name = message.notifyName || 'Não informado';
        await TrialRequest.create({ phone, name });

        await sendMessage(message.from, `✅ *Solicitação de teste registrada!*
Aguarde enquanto preparamos seu acesso. Você receberá as credenciais em instantes.`);

        await sendMessage(`${OWNER_PHONE}@c.us`, `⚠️ *NOVA SOLICITAÇÃO DE TESTE TV* ⚠️\n\n` +
          `Cliente: ${name}\n` +
          `Número: ${phone}\n\n` +
          `Para aprovar e enviar, responda:\n` +
          `*enviar teste ${phone}*`);
        return;
    }

    // --- Respostas do Menu ---
    const menuResponses = {
      '01': `*COMO FUNCIONA?* 🤔...`, // (Mantenha suas mensagens originais aqui)
      '02': `*PLANOS TV* 📺...`,
      '03': `*PLANO INTERNET ILIMITADA* 🛰️...`,
      '04': `*FORMAS DE PAGAMENTO* 💰\n\n*Para pagar com PIX:*\n\nNome: Bruno Santos\nBanco: PicPay\n\n*Valores:*\n- TV: R$ 40,00 (básico) ou R$ 60,00 (premium)\n- Internet: R$ 25,00\n\n*Chave PIX aleatória:*\ne8f54c2a-4f0d-4b12-9b5b-7317dba8d1eb\n\n⚠️ *OBS: Envie o comprovante para liberação!*⚠️ *Sem comprovante não há liberação.*\n\nPara ver a chave PIX novamente, digite *PIX*`,
      '05': `*PERGUNTAS FREQUENTES* ⁉️...`,
      '06': `*DOWNLOAD DE APPS* 🆓️...`,
      '07': `*SUPORTE* 🕵🏽‍♂️...`,
      '08': `*APARELHOS COMPATÍVEIS* ✅...`,
      '#': `👨‍💼 *ATENDIMENTO HUMANO* 👨‍💼\n\nVocê será atendido por nosso especialista em breve.\n\n⏱️ Aguarde alguns instantes...`,
      'pix': `*FORMAS DE PAGAMENTO* 💰\n\n*Para pagar com PIX:*\n\nNome: Bruno Santos\nBanco: PicPay\n\n*Valores:*\n- TV: R$ 40,00 (básico) ou R$ 60,00 (premium)\n- Internet: R$ 25,00\n\n*Chave PIX aleatória:*\ne8f54c2a-4f0d-4b12-9b5b-7317dba8d1eb\n\n⚠️ *OBS: Envie o comprovante para liberação!*⚠️ *Sem comprovante não há liberação.*\n\nPara ver a chave PIX novamente, digite *PIX*`
    };
    
    // (Para economizar espaço, abreviei suas mensagens. Cole as suas mensagens completas de volta aqui)
    Object.assign(menuResponses, {
        '01': `*COMO FUNCIONA?* 🤔\n\nNosso serviço de TV oferece:\n- 📺 +15.000 canais HD/4K\n- 🎬 Filmes e séries atualizados\n- ⚡ Funcionamento 24h\n- 📱 Suporte em todos os dispositivos\n\n*PLANO INTERNET ILIMITADA* 🛰️:\n- 🌐 Dados ilimitados no seu celular\n- 🚫 Sem franquia de uso\n- ⚡ Velocidade de até 5G (depende da cobertura)\n- 📶 Funciona em qualquer operadora`,
        '02': `*PLANOS TV* 📺\n\n🔥 *PLANO BÁSICO*:\n- 1 tela: *R$ 40,00/mês*\n- Canais essenciais\n\n🔥 *PLANO PREMIUM*:\n- 1 tela: *R$ 60,00/mês*\n- Todos os canais + filmes\n\n💡 *PROMOÇÃO*:\n- 3 meses: *R$ 150,00* (economize R$ 30)\n- 6 meses: *R$ 280,00* (economize R$ 80)\n\nPara testar nosso serviço, digite *TESTE TV*`,
        '03': `*PLANO INTERNET ILIMITADA* 🛰️\n\n🌐 *PLANO MENSAL*:\n- *R$ 25,00/mês*\n- Dados ilimitados\n- Velocidade média de 10 Mbps\n\n🌐 *PLANO TRIMESTRAL*:\n- *R$ 65,00/3 meses* (economize R$ 10)\n\n💡 *ATENÇÃO*:\n- Funciona apenas em celulares Android\n- Não é banda larga para residência`,
        '05': `*PERGUNTAS FREQUENTES* ⁉️\n\n1️⃣ *Posso usar o mesmo login em vários aparelhos?*\n➡️ NÃO, logins são individuais.\n\n2️⃣ *Diferença entre nosso acesso e operadoras tradicionais?*\n➡️ Nas operadoras você paga por mega. Aqui é ilimitado por valor fixo.\n\n3️⃣ *Posso compartilhar minha internet?*\n➡️ NÃO, planos são individuais. Para mais aparelhos, contrate planos adicionais.\n\n4️⃣ *Formas de pagamento?*\n➡️ PIX, transferência ou boleto.\n\n5️⃣ *Como solicitar suporte?*\n➡️ Informe: canal, qualidade, filme/série, capítulo/episódio, servidor e problema.\n\n6️⃣ *Tem fidelidade?*\n➡️ NÃO, pode cancelar quando quiser.\n\n7️⃣ *Vendem internet banda larga?*\n➡️ NÃO, apenas para celular Android.\n\n⚠️ *Após pagamento não há reembolso. Faça teste antes!*`,
        '06': `*DOWNLOAD DE APPS* 🆓️\n\n*Atenção: Não instalamos pela Play Store.*\n\n📱 *Para Android:*\n1. Abra o Chrome\n2. Acesse: https://abrela.me/digital+\n3. Baixe e instale o app\n\n📺 *Para Smart TV:*\n- LG: Loja de apps > Buscar > iboplayer\n- Samsung: Loja de apps > Buscar > iboplayer\n(custo adicional de R$20,00/ano)\n\n*Após instalar, digite TESTE TV para receber acesso.*`,
        '07': `*SUPORTE* 🕵🏽‍♂️\n\n*Problemas comuns:*\n\n1️⃣ *TV travando?*\n➡️ Desligue roteador e aparelho por 5 minutos.\n\n2️⃣ *Canal/filme não funciona?*\n➡️ Mude a qualidade (SD/HD/FHD) ou informe:\n   - Nome do canal/filme\n   - Episódio/capítulo\n   - Servidor usado\n   - Imagem/vídeo do erro\n\n3️⃣ *Acesso não funciona?*\n➡️ Verifique vencimento do plano.`,
        '08': `*APARELHOS COMPATÍVEIS* ✅\n\n- Computador: ✅\n- iPhone/iPad: ✅\n- Smart TV LG: ✅\n- Smart TV Samsung (Tizen 2018+): ✅ (custo adicional R$20/ano)\n- Android (celular/tablet): ✅\n- TV Box: ✅\n- Fire Stick: ✅\n- Smart TV TCL: ✅\n- Xbox/PS4: ✅\n\n⚠️ *Smart TVs: custo adicional de R$20,00/ano (app iboplayer)*`
    });

    const normalizedInput = body.replace(/[^\d#]/g, '').slice(0, 2); // Limpa a entrada, mantendo só números e #
    const response = menuResponses[normalizedInput] || menuResponses[body]; // Tenta encontrar resposta pela entrada normalizada ou pelo texto exato (para 'pix')

    if (response) {
      await sendMessage(message.from, response);
      if (normalizedInput === '#') {
        await sendMessage(`${OWNER_PHONE}@c.us`, `⚠️ *SOLICITAÇÃO DE ATENDENTE HUMANO* ⚠️\n\nCliente: ${message.notifyName} (${phone})\nPor favor, entre em contato!`);
      } else {
        // Reenvia o menu principal após a resposta, exceto se for pedido de atendente
        await sendMainMenu(message.from);
      }
    } else {
      // Se nenhuma opção corresponder, envia o menu principal
      await sendMainMenu(message.from);
    }

  } catch (error) {
    console.error(`ERRO FATAL AO PROCESSAR MENSAGEM de ${message.from}:`, error);
    await sendMessage(`${OWNER_PHONE}@c.us`, `⚠️ *ERRO CRÍTICO NO BOT* ⚠️\n\nOcorreu um erro ao processar uma mensagem. Verifique os logs do servidor imediatamente.`);
  }
});


// --- Inicialização ---

console.log('Inicializando cliente do WhatsApp...');
client.initialize();

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Para visualizar o status, acesse: http://localhost:${PORT}`);
});
