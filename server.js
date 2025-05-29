const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const PDFLib = require("pdf-lib");
const cors = require("cors");
const bodyParser = require("body-parser");
const url = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir); // Cria uploads automaticamente
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads")); // Serve os PDFs assinados

// Banco de dados temporário em memória
let pedidos = {};

// Upload do PDF com dados do cliente
app.post("/upload", upload.single("pdf"), (req, res) => {
  try {
    const id = Math.random().toString(36).substring(2);
    const { x, y, imgWidth, imgHeight } = req.body;
    const filePath = req.file.path;

    pedidos[id] = {
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

// Recebe a assinatura e insere no PDF
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

    // Ajuste proporcional da posição marcada pelo criador
    const xReal = parseFloat(pedido.x) * (width / parseFloat(pedido.imgWidth));
    const yReal = parseFloat(pedido.y) * (height / parseFloat(pedido.imgHeight));
    const yPdf = height - yReal - 40;

    // Insere assinatura
    const pngImage = await pdfDoc.embedPng(fs.readFileSync(pngPath));
    firstPage.drawImage(pngImage, {
      x: xReal,
      y: yPdf,
      width: 120,
      height: 40
    });

    // ✅ Correção do fuso horário para Brasília (GMT-3)
    const agora = new Date();

    // Ajusta para horário do Brasil (GMT-3)
    const offsetBrasil = -3 * 60; // minutos do GMT-3 (Brasília)
    const dataBrasil = new Date(agora.getTime() + offsetBrasil * 60 * 1000);

    const dia = String(dataBrasil.getDate()).padStart(2, '0');
    const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0'); // Mês começa do 0
    const ano = dataBrasil.getFullYear();
    const hora = String(dataBrasil.getHours()).padStart(2, '0');
    const minuto = String(dataBrasil.getMinutes()).padStart(2, '0');

    const dataFormatada = `${dia}/${mes}/${ano} - ${hora}:${minuto}`;

    // Adiciona texto da data/hora no PDF
    const helveticaFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    firstPage.drawText(dataFormatada, {
      x: xReal,
      y: yPdf - 20,
      size: 10,
      font: helveticaFont,
      color: PDFLib.rgb(0, 0, 0)
    });

    // Gera nome seguro com base no nome do cliente
    const referer = req.headers.referer;
    const parsed = url.parse(referer, true);
    const nomeCliente = decodeURIComponent(parsed.query.nome || "Cliente");

    const safeName = nomeCliente.replace(/[^a-zA-Z0-9]/g, '_');
    const signedPath = `uploads/${safeName}-assinado.pdf`;

    // Se já existe, impede novo envio
    if (fs.existsSync(signedPath)) {
      return res.status(400).json({ error: "Documento já foi assinado." });
    }

    const savedPdfBytes = await pdfDoc.save();
    fs.writeFileSync(signedPath, savedPdfBytes);

    res.json({ url: `/uploads/${safeName}-assinado.pdf` });
  } catch (error) {
    console.error("Erro no /assinar:", error);
    res.status(500).json({ error: "Erro ao inserir assinatura" });
  }
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
