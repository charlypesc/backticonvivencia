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
const { verifyToken, requireRole } = require('../middleware/auth');

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
router.post('/',          requireRole('ENCARGADO'), create);
router.post('/importar',  requireRole('ENCARGADO'), uploadExcel.single('archivo'), importarExcel);
router.get('/importar/:jobId/progreso', requireRole('ENCARGADO'), getProgresoImportacion);
router.put('/:id',        requireRole('ENCARGADO'), update);
router.delete('/:id',     requireRole('ENCARGADO'), remove);

module.exports = router;
