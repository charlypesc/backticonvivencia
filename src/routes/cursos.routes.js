const router = require('express').Router();
const multer = require('multer');
const {
  getAll, create, update, remove, importarExcel, getProgresoImportacion,
  resumenEliminacion, eliminarTodos,
} = require('../controllers/cursos.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

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

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/',       getAll);                            // ambos roles
router.post('/',      requirePermission(Permiso.CursoCrear), create);  // solo ENCARGADO
router.post('/importar', requirePermission(Permiso.CursoImportar), uploadExcel.single('archivo'), importarExcel); // solo ENCARGADO
router.get('/importar/:jobId/progreso', requirePermission(Permiso.CursoImportar), getProgresoImportacion); // solo ENCARGADO
// Borrado masivo (deshacer importación): permiso propio, hoy solo del ADMIN.
// Va antes de '/:id' para que no lo capture esa ruta.
router.get('/resumen-eliminacion', requirePermission(Permiso.CursoEliminarMasivo), resumenEliminacion);
router.delete('/', requirePermission(Permiso.CursoEliminarMasivo), eliminarTodos);

router.put('/:id',    requirePermission(Permiso.CursoEditar), update);  // solo ENCARGADO
router.delete('/:id', requirePermission(Permiso.CursoEliminar), remove);  // solo ENCARGADO

module.exports = router;
