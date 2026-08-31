const router = require('express').Router();
const multer = require('multer');
const {
  getAll, crear, publicar, getConstancias, registrarConstancia,
  descargarDocumento,
} = require('../controllers/documentosInstitucionales.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

// El RICE completo de un colegio es un PDF grande, y una constancia escaneada
// desde el teléfono también puede serlo. El límite es holgado a propósito: si
// alguien no puede registrar la entrega porque su escáner produjo un archivo
// pesado, el sistema lo está empujando a no dejar constancia, que es lo único
// que la ley realmente exige.
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

router.get ('/',              requirePermission(Permiso.DocumentoInstitucionalVer),       getAll);
router.post('/',              requirePermission(Permiso.DocumentoInstitucionalGestionar), upload.single('archivo'), crear);
router.post('/:id/publicar',  requirePermission(Permiso.DocumentoInstitucionalGestionar), publicar);
router.get ('/:id/archivo',   requirePermission(Permiso.DocumentoInstitucionalVer),       descargarDocumento);

// Las constancias cuelgan del documento porque acreditan la entrega de ESA
// versión: una constancia sin versión no prueba nada.
router.get ('/:id/constancias', requirePermission(Permiso.ConstanciaVer),       getConstancias);
router.post('/:id/constancias', requirePermission(Permiso.ConstanciaRegistrar), upload.single('archivo'), registrarConstancia);

module.exports = router;
