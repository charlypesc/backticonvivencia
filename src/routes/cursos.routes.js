const router = require('express').Router();
const multer = require('multer');
const { getAll, create, update, remove, importarExcel, getProgresoImportacion } = require('../controllers/cursos.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
    ];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Solo se admiten archivos Excel (.xlsx, .xls)'));
  },
});

router.use(verifyToken);

router.get('/',       getAll);                            // ambos roles
router.post('/',      requireRole('ENCARGADO'), create);  // solo ENCARGADO
router.post('/importar', requireRole('ENCARGADO'), uploadExcel.single('archivo'), importarExcel); // solo ENCARGADO
router.get('/importar/:jobId/progreso', requireRole('ENCARGADO'), getProgresoImportacion); // solo ENCARGADO
router.put('/:id',    requireRole('ENCARGADO'), update);  // solo ENCARGADO
router.delete('/:id', requireRole('ENCARGADO'), remove);  // solo ENCARGADO

module.exports = router;
