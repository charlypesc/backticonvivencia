const express = require('express');
const router = express.Router();
const multer = require('multer');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { bloquearEscrituraConfidencial } = require('../middleware/confidencial');
const { subirDocumento, obtenerPorRegistro } = require('../controllers/documentos.controller');
const { Permiso } = require('../constants/permisos');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
    ];
    // Safari/Android a veces mandan las fotos HEIC sin mimetype útil
    // (application/octet-stream o vacío), así que caemos a la extensión.
    const esHeicPorExtension = /\.(heic|heif)$/i.test(file.originalname || '');
    allowed.includes(file.mimetype) || esHeicPorExtension
      ? cb(null, true)
      : cb(new Error('Tipo de archivo no permitido'));
  },
});

// Antes estas dos rutas solo pedían estar autenticado: cualquier usuario podía
// subir documentos. Ahora van por permiso, como el resto del sistema.
router.use(verifyToken, resolverScope, requireEstablecimiento);

router.post('/', requirePermission(Permiso.DocumentoSubir), upload.single('archivo'), subirDocumento);
// El documento digitalizado guarda el texto OCR del acta: si el registro es
// confidencial, entregarlo sería devolver el mismo contenido que se está
// ocultando en /api/registros, solo que por otra puerta.
router.get('/registro/:id_registro', requirePermission(Permiso.DocumentoVer),
  bloquearEscrituraConfidencial, obtenerPorRegistro);

module.exports = router;