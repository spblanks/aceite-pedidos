const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const PDFLib = require("pdf-lib");
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

// Banco de dados temporário em arquivo
const PEDIDOS_FILE = "pedidos.json";

function carregarPedidos() {
  if (!fs.existsSync(PEDIDOS_FILE)) {
    fs.writeFileSync(PEDIDOS_FILE, "{}");
  }
  return JSON.parse(fs.readFileSync(PEDIDOS_FILE));
}

function salvarPedidos(pedidos) {
  fs.writeFileSync(PEDIDOS_FILE, JSON.stringify(pedidos, null, 2));
}

let pedidos = carregarPedidos();

// Upload do PDF com dados do cliente
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

    salvarPedidos(pedidos);
    res.json({ id });
  } catch (error) {
    console.error("Erro no /upload:", error);
    res.status(500).json({ error: "Erro ao processar o upload" });
  }
});

// Envia o PDF original para o cliente
app.get("/pedido/:id", (req, res) => {
  const { id } = req.params;

  // Se o pedido ainda existir localmente, mostra
  if (pedidos[id]) {
    res.sendFile(path.resolve(pedidos[id].filePath));
    return;
  }

  // Se não estiver mais salvo, tenta mostrar o PDF assinado, se existir
  const safeName = decodeURIComponent(req.query.nome || "Cliente").replace(/[^a-zA-Z0-9]/g, '_');
  const signedPath = `uploads/${safeName}-assinado.pdf`;

  if (fs.existsSync(signedPath)) {
    res.sendFile(path.resolve(signedPath));
    return;
  }

  res.send("PDF não encontrado. O pedido pode ter sido apagado após reinicialização.");
});

// Recebe a assinatura e insere no PDF
app.post("/assinar/:id", upload.single("assinatura"), async (req, res) => {
  try {
    const { id } = req.params;

    // Se o pedido ainda estiver salvo, usa ele
    if (pedidos[id]) {
      const pedido = pedidos[id];

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

      // Adiciona data/hora Brasília
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

      // Gera nome seguro com base no nome do cliente
      const safeName = decodeURIComponent(pedido.nome).replace(/[^a-zA-Z0-9]/g, '_');
      const signedPath = `uploads/${safeName}-assinado.pdf`;

      // Se já existe, impede nova assinatura
      if (fs.existsSync(signedPath)) {
        return res.status(400).json({ error: "Documento já foi assinado." });
      }

      fs.writeFileSync(signedPath, savedPdfBytes);

      // Retorna link pro cliente baixar
      res.json({ url: `/${safeName}-assinado.pdf` });
    } else {
      // Se o pedido já foi perdido, tenta recuperar pelo nome no query param
      const nomeCliente = req.body.nome || urlParams.get("nome") || "Cliente";
      const safeName = decodeURIComponent(nomeCliente).replace(/[^a-zA-Z0-9]/g, '_');

      // Tenta retornar o PDF assinado, se já existir
      const signedPath = `uploads/${safeName}-assinado.pdf`;
      if (fs.existsSync(signedPath)) {
        return res.json({ url: `/${safeName}-assinado.pdf` });
      }

      res.status(404).send("Pedido não encontrado. O pedido pode ter expirado.");
  }
} catch (error) {
  console.error("Erro no /assinar:", error.message);
  res.status(500).json({ error: "Erro ao inserir assinatura" });
});

// Nova rota: listar todos os PDFs assinados
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
