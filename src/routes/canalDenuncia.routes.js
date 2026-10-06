const router = require('express').Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { canalPublico, enviarDenuncia } = require('../controllers/denuncias.controller');

// Formulario PÚBLICO del canal de denuncias: sin sesión, se llega por el QR
// del colegio. Ver denuncias.controller.js.

// Fotos de pantalla y fotos tomadas con el teléfono: se aceptan pesadas y las
// achica comprimirArchivo. El límite solo está para que nadie tumbe el server
// mandando un archivo de un giga.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    // Algunos Android mandan las fotos HEIC sin tipo (application/octet-stream):
    // se reconoce también por la extensión para no rechazar una foto válida.
    const ok = file.mimetype?.startsWith('image/') || file.mimetype === 'application/pdf'
      || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.originalname ?? '');
    ok ? cb(null, true) : cb(new Error('Solo se pueden adjuntar fotos o PDF'));
  },
});

// Un error de multer (archivo de otro tipo, más de 5) tiene que llegar como
// mensaje legible, no como un 500 genérico de Express.
const subirArchivos = (req, res, next) =>
  upload.array('archivos', 5)(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
      ? 'Puedes adjuntar hasta 5 archivos'
      : err.message;
    res.status(400).json({ message });
  });

// Contra el spam y los envíos repetidos. El contador vive en memoria y se
// olvida solo: la IP no se guarda en ninguna parte, que es lo que hace que el
// canal anónimo sea anónimo de verdad.
const limiteEnvios = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Enviaste varias denuncias seguidas. Espera unos minutos antes de mandar otra.' },
});

router.get('/:token', canalPublico);
router.post('/:token', limiteEnvios, subirArchivos, enviarDenuncia);

module.exports = router;
