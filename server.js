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
  destination: (req, file, cb) => {
    const dir = "uploads/";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
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
app.use("/uploads", express.static("uploads"));

// Banco de dados temporário
let pedidos = {};

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

    // Gera nome seguro com base no nome do cliente
    const safeName = pedido.nome.replace(/[^a-zA-Z0-9]/g, '_');
    const signedPath = `uploads/${safeName}-assinado.pdf`;

    // Impede assinaturas repetidas
    if (fs.existsSync(signedPath)) {
      return res.status(400).json({ error: "Documento já foi assinado.", code: "ALREADY_SIGNED" });
    }

    fs.writeFileSync(signedPath, savedPdfBytes);

    res.json({ url: `/${safeName}-assinado.pdf` });
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
