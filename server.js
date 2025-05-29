const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const PDFLib = require("pdf-lib");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

let pedidos = {};

// Upload do PDF com dados do cliente
app.post("/upload", upload.single("pdf"), (req, res) => {
  const id = Math.random().toString(36).substring(2);
  const { nome, x, y } = req.body;
  const filePath = req.file.path;

  pedidos[id] = { nome, filePath, x, y };

  res.json({ id });
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
  const { id } = req.params;
  const pedido = pedidos[id];
  if (!pedido) return res.status(404).send("Pedido não encontrado");

  const pdfBytes = fs.readFileSync(pedido.filePath);
  const pngPath = req.file.path;

  const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
  const firstPage = pdfDoc.getPage(0);

  const pngImage = await pdfDoc.embedPng(fs.readFileSync(pngPath));
  firstPage.drawImage(pngImage, {
    x: parseFloat(pedido.x),
    y: parseFloat(pedido.y),
    width: 120,
    height: 40
  });

  const savedPdfBytes = await pdfDoc.save();
  const signedPath = `uploads/${id}-assinado.pdf`;
  fs.writeFileSync(signedPath, savedPdfBytes);

  res.json({ url: `http://localhost:3000/uploads/${id}-assinado.pdf` });
});

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));