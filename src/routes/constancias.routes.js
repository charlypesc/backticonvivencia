const router = require('express').Router();
const multer = require('multer');
const {
  adjuntarFirmada, descargarConstancia,
} = require('../controllers/documentosInstitucionales.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    permitidos.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('El archivo debe ser PDF o imagen'));
  },
});

router.use(verifyToken, resolverScope, requireEstablecimiento);

// Acciones sobre una constancia ya registrada. El alta cuelga del documento.
router.put('/:id/archivo', requirePermission(Permiso.ConstanciaRegistrar), upload.single('archivo'), adjuntarFirmada);
router.get('/:id/archivo', requirePermission(Permiso.ConstanciaVer), descargarConstancia);

module.exports = router;
