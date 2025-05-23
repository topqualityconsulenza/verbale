const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const PDFKitDocument = require('pdfkit');            // <— rinominato
const { PDFDocument, rgb } = require('pdf-lib')  
const moment = require('moment');
const archiver = require('archiver');

const app = express();
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });
const signedDir = path.join(__dirname, 'signed');
const uploadsDir = path.join(__dirname, 'uploads');
const dataFile = path.join(__dirname, 'data.json');

if (!fs.existsSync(dataFile)) fs.writeJsonSync(dataFile, []);
if (!fs.existsSync(signedDir)) fs.mkdirSync(signedDir);

function loadRecords() {
  return fs.readJsonSync(dataFile);
}
function saveRecords(records) {
  fs.writeJsonSync(dataFile, records, { spaces: 2 });
}

app.get('/', (req, res) => res.redirect('/create'));

app.get('/create', (req, res) => res.render('create'));

app.post('/create', upload.array('allegati'), (req, res) => {
  const { ragione, nome_firma, cognome_firma, altro } = req.body;
  const checkboxes = req.body.checkboxes || [];
  const allegati = req.files.map(f => f.filename);
  const records = loadRecords();
  const id = Date.now().toString();
  const date = moment().format('DD-MM-YYYY HH:mm');

  // Costruzione dati documenti con dettagli
  const documenti = [
    'DVR', 'Manuale Haccp', 'Implementazione Haccp', 'Attestato Haccp', 'Attestato RSPP', 'Attestato RLS',
    'Attestato Primo Soccorso', 'Attestato Antincendio', 'Attestato Formazione', 'Giudizio Sanitario',
    'Report Analisi (Tamponi/ Acqua)', 'GDPR (Modello organizzativo)'
  ];
  const selectedDocs = [];

  if (Array.isArray(checkboxes)) {
    checkboxes.forEach((doc, index) => {
      const dettaglio = req.body[`details_${index}`];
      selectedDocs.push({ nome: doc, dettaglio });
    });
  } else {
    // Singolo documento selezionato
    const index = documenti.indexOf(checkboxes);
    const dettaglio = req.body[`details_${index}`];
    selectedDocs.push({ nome: checkboxes, dettaglio });
  }

  // Salva record
  records.push({
    id,
    ragione,
    altro,
    allegati,
    selectedDocs,
    date
  });
  saveRecords(records);

  // Crea PDF
  const pdfPath = path.join(signedDir, `${id}-${ragione.replace(/[^a-z0-9]/gi, '_')}.pdf`);
  const docPdf = new PDFKitDocument();        // usa pdfkit
  docPdf.pipe(fs.createWriteStream(pdfPath));

  docPdf.fontSize(18).text('Verbale di Consegna Documentazione', { align: 'center' });
  docPdf.moveDown();
  docPdf.fontSize(12);
  docPdf.text(`Ragione Sociale: ${ragione}`);
  docPdf.text(`Data: ${date}`);
  docPdf.moveDown();

  docPdf.text('Documentazione consegnata:');
  selectedDocs.forEach(item => {
    const linea = `- ${item.nome}${item.dettaglio ? `: ${item.dettaglio}` : ''}`;
    docPdf.text(linea, { indent: 20 });
  });

  if (altro && altro.trim() !== '') {
    docPdf.moveDown();
    docPdf.text(`Altro: ${altro}`, { indent: 20 });
  }

  docPdf.end();

  res.redirect('/list');
});

app.get('/list', (req, res) => {
  const records = loadRecords();
  res.render('list', { records });
});

app.get('/edit/:id', (req, res) => {
  const record = loadRecords().find(r => r.id === req.params.id);
  if (!record) return res.send('Verbale non trovato');
  res.render('edit', { record });
});

app.post('/edit/:id', upload.array('allegati'), (req, res) => {
  const { ragione, nome_firma, cognome_firma, altro } = req.body;
  const checkboxes = req.body.checkboxes || [];                  // i checkbox selezionati
  const nuoviAllegati = req.files.map(f => f.filename);         // eventuali nuovi file
  const records = loadRecords();
  const record = records.find(r => r.id === req.params.id);
  if (!record) return res.status(404).send('Verbale non trovato');

  // Aggiorna i campi base
  record.ragione      = ragione;
  record.nome_firma   = nome_firma;
  record.cognome_firma= cognome_firma;
  record.altro        = altro;
  // Unisci nuovi allegati
  record.allegati     = (record.allegati || []).concat(nuoviAllegati);

  // Ricostruisci selectedDocs
  const documentiList = [
    'DVR','Manuale Haccp','Implementazione Haccp','Attestato Haccp',
    'Attestato RSPP','Attestato RLS','Attestato Primo Soccorso',
    'Attestato Antincendio','Attestato Formazione','Giudizio Sanitario',
    'Report Analisi (Tamponi/ Acqua)','GDPR (Modello organizzativo)'
  ];

  record.selectedDocs = []; 
  // checkbox può essere stringa o array
  const arr = Array.isArray(checkboxes) ? checkboxes : [checkboxes];
  arr.forEach(docName => {
    const idx = documentiList.indexOf(docName);
    if (idx !== -1) {
      record.selectedDocs.push({
        nome: docName,
        dettaglio: req.body[`details_${idx}`] || ''
      });
    }
  });

  saveRecords(records);
  res.redirect('/list');
});

app.get('/delete/:id', (req, res) => {
  let records = loadRecords();
  const record = records.find(r => r.id === req.params.id);
  if (!record) return res.send('Verbale non trovato');

  // Elimina file allegati
  record.allegati.forEach(file => {
    const filePath = path.join(uploadsDir, file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  // Elimina PDF generato
  const pdfName = `${record.id}-${record.ragione.replace(/[^a-z0-9]/gi, '_')}.pdf`;
  const pdfPath = path.join(signedDir, pdfName);
  if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

  records = records.filter(r => r.id !== req.params.id);
  saveRecords(records);

  res.redirect('/list');
});

app.get('/download/:id', (req, res) => {
  const record = loadRecords().find(r => r.id === req.params.id);
  if (!record) return res.status(404).send('Verbale non trovato');

  // Nome del file ZIP
  const zipName = `${record.ragione.replace(/[^a-z0-9]/gi, '_')}_${record.id}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => res.status(500).send({ error: err.message }));
  archive.pipe(res);

  // 1) Aggiungi il PDF generato del verbale
  const pdfPath = path.join(signedDir, `${record.id}-${record.ragione.replace(/[^a-z0-9]/gi, '_')}.pdf`);
  if (fs.existsSync(pdfPath)) {
    archive.file(pdfPath, { name: `${record.ragione}.pdf` });
  }

  // 2) Aggiungi tutti gli allegati
  record.allegati.forEach(file => {
    const filePath = path.join(uploadsDir, file);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: `${ file }.pdf`});
    }
  });

  archive.finalize();
});

// --- FIRMA PDF ---
app.get('/sign', (req, res) => res.render('sign'));

app.post('/sign', upload.single('pdf'), async (req, res) => {
  try {
    const nome = req.body.nome_firma;
    const cognome = req.body.cognome_firma;
    const signatureData = req.body.firma;
    const date = new Date().toLocaleDateString('it-IT');
    const tmpPath = req.file.path;

    const existingPdfBytes = fs.readFileSync(tmpPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // embed firma PNG
    const pngBytes = Buffer.from(signatureData.split(',')[1], 'base64');
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const pngDims = pngImage.scale(0.5);

    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();

    // disegna firma
    lastPage.drawImage(pngImage, {
      x: width - pngDims.width - 50,
      y: 50,
      width: pngDims.width,
      height: pngDims.height,
    });
    // disegna nome cognome
    lastPage.drawText(`${nome} ${cognome}`, {
      x: width - pngDims.width - 50,
      y: 40 + pngDims.height,
      size: 12,
      color: rgb(0,0,0)
    });
    // disegna data
    lastPage.drawText(date, {
      x: 50,
      y: 40,
      size: 12,
      color: rgb(0,0,0)
    });

    const signedPdfBytes = await pdfDoc.save();
    const filename = `${Date.now()}-${req.file.originalname}`;
    const destPath = path.join(signedDir, filename);
    fs.writeFileSync(destPath, signedPdfBytes);
    fs.unlinkSync(tmpPath);

    res.redirect('/signed_list');
  } catch (err) {
    console.error('Errore durante la firma del PDF:', err);
    res.status(500).send('Errore nella firma del documento');
  }
});

app.get('/signed_list', (req, res) => {
  const files = fs.readdirSync(signedDir).filter(f => f.endsWith('.pdf'));
  res.render('signed_list', { files });
});

app.get('/download-signed/:file', (req, res) => {
  const filePath = path.join(signedDir, req.params.file);
  res.download(filePath);
});

app.get('/delete-signed/:file', (req, res) => {
  const filePath = path.join(signedDir, req.params.file);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.redirect('/signed_list');
});

// --- ZIP DOWNLOAD ---
app.get('/download-all', (req, res) => {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const zipName = `documenti_firmati_${Date.now()}.zip`;

  res.attachment(zipName);
  archive.pipe(res);
  fs.readdirSync(signedDir).forEach(file => {
    const filePath = path.join(signedDir, file);
    archive.file(filePath, { name: file });
  });
  archive.finalize();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));

