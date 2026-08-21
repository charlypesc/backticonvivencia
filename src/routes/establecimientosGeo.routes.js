const router = require('express').Router();
const multer = require('multer');
const {
  getAll,
  create,
  update,
  remove,
  importarExcel,
  getProgresoImportacion,
} = require('../controllers/establecimientosGeo.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max — el directorio nacional de RBD pesa ~1MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
    ];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Solo se admiten archivos Excel (.xlsx, .xls)'));
  },
});

router.use(verifyToken);

router.get('/',           getAll);                                                    // ambos roles
router.post('/',          requirePermission(Permiso.EstablecimientoCrear), create);
router.post('/importar',  requirePermission(Permiso.EstablecimientoImportar), uploadExcel.single('archivo'), importarExcel);
router.get('/importar/:jobId/progreso', requirePermission(Permiso.EstablecimientoImportar), getProgresoImportacion);
router.put('/:id',        requirePermission(Permiso.EstablecimientoEditar), update);
router.delete('/:id',     requirePermission(Permiso.EstablecimientoEliminar), remove);

module.exports = router;
