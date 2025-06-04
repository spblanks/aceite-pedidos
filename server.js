const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const PDFLib = require("pdf-lib");
const { google } = require("googleapis");
const { OAuth2Client } = require("google-auth-library");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de upload
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// Autenticação Google Drive
const CLIENT_ID = "SEU_CLIENT_ID.apps.googleusercontent.com";
const CLIENT_SECRET = "SEU_CLIENT_SECRET";
const REDIRECT_URI = "http://localhost:3000/auth/callback";

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
let tokens = null;

// Banco de dados temporário em memória
let pedidos = {};

// Rota de autenticação Google
app.get("/auth/google", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/drive.file"] 
  });
  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync("tokens.json", JSON.stringify(tokens));
  res.send("✅ Autenticado no Google Drive!");
});

// Carrega tokens se existirem
if (fs.existsSync("tokens.json")) {
  const savedTokens = fs.readFileSync("tokens.json");
  oauth2Client.setCredentials(JSON.parse(savedTokens));
}

// Upload do PDF
app.post("/upload", upload.single("pdf"), (req, res) => {
  try {
    const id = Math.random().toString(36).substring(2);
    const { nome, x, y, imgWidth, imgHeight } = req.body;
    const filePath = req.file.path;

    pedidos[id] = {
      nome,
      filePath,
      x,
      y,
      imgWidth,
      imgHeight
    };

    res.json({ id });
  } catch (error) {
    console.error("Erro no /upload:", error);
    res.status(500).json({ error: "Erro ao processar o upload" });
  }
});

// Envia o PDF original para o cliente
app.get("/pedido/:id", (req, res) => {
  const { id } = req.params;
  const pedido = pedidos[id];

  if (!pedido) return res.status(404).send("Pedido não encontrado");

  res.sendFile(path.resolve(pedido.filePath));
});

// Recebe a assinatura e salva no Google Drive
app.post("/assinar/:id", upload.single("assinatura"), async (req, res) => {
  try {
    const { id } = req.params;
    const pedido = pedidos[id];

    if (!pedido) return res.status(404).send("Pedido não encontrado");

    const pdfBytes = fs.readFileSync(pedido.filePath);
    const pngPath = req.file.path;

    const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
    const firstPage = pdfDoc.getPage(0);
    const { width, height } = firstPage.getSize();

    const xReal = parseFloat(pedido.x) * (width / parseFloat(pedido.imgWidth));
    const yReal = parseFloat(pedido.y) * (height / parseFloat(pedido.imgHeight));
    const yPdf = height - yReal - 40;

    const pngImage = await pdfDoc.embedPng(fs.readFileSync(pngPath));
    firstPage.drawImage(pngImage, {
      x: xReal,
      y: yPdf,
      width: 120,
      height: 40
    });

    // Data/hora Brasília
    const agora = new Date();
    const dataBrasil = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const helveticaFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    firstPage.drawText(dataBrasil, {
      x: xReal,
      y: yPdf - 20,
      size: 10,
      font: helveticaFont,
      color: PDFLib.rgb(0, 0, 0)
    });

    const savedPdfBytes = await pdfDoc.save();

    const safeName = decodeURIComponent(pedido.nome).replace(/[^a-zA-Z0-9]/g, '_');
    const signedPath = `uploads/${safeName}-assinado.pdf`;

    if (fs.existsSync(signedPath)) {
      return res.status(400).json({ error: "Documento já foi assinado." });
    }

    fs.writeFileSync(signedPath, savedPdfBytes);

    // ✅ Agora vamos subir para o Google Drive
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const fileMetadata = {
      name: `${safeName}-assinado.pdf`,
      parents: ["ID_DA_PASTA_DRIVE"] // ← Substitua pelo ID da sua pasta no GD
    };
    const media = {
      mimeType: "application/pdf",
      body: fs.createReadStream(signedPath)
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media
    });

    // Compartilha publicamente (opcional)
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    // Retorna link público do Google Drive
    const publicLink = `https://drive.google.com/uc?id=${response.data.id}&export=download`;
    res.json({ url: publicLink });
  } catch (error) {
    console.error("Erro no /assinar:", error.message);
    res.status(500).json({ error: "Erro ao salvar no Google Drive" });
  }
});

// Nova rota: listar todos os PDFs assinados localmente (não usado no GD)
app.get("/listar-assinados", (req, res) => {
  const dir = path.join(__dirname, "uploads");
  fs.readdir(dir, (err, files) => {
    if (err) return res.status(500).json({ error: "Erro ao ler diretório" });
    const pdfsAssinados = files.filter(f => f.includes("-assinado.pdf"));
    res.json(pdfsAssinados);
  });
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
