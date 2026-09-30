const router = require('express').Router();
const multer = require('multer');
const {
  getAll, create, update, toggleActivo, resetPassword,
  getRoles, asignarRol, quitarRol,
  getPermisos, setPermisos, guardarPermisosComoRol,
} = require('../controllers/usuarios.controller');
const { plantilla, importar } = require('../controllers/usuariosImportar.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope);

// Alta masiva: la plantilla Excel y la subida del archivo ya llenado. Van con
// el mismo permiso que el alta de a uno. El filtro es por extensión además del
// mimetype: algunos navegadores mandan los .xlsx como application/octet-stream.
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    /\.(xlsx|xls)$/i.test(file.originalname) || /spreadsheet|ms-excel/.test(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Sube la plantilla en formato Excel (.xlsx)')),
});
router.get('/plantilla', requirePermission(Permiso.UsuarioCrear), plantilla);
// El error de multer (archivo que no es Excel) se responde como JSON: sin
// manejador de errores global, Express devolvería su página HTML de 500.
const subirExcel = (req, res, next) =>
  uploadExcel.single('archivo')(req, res, (err) =>
    err ? res.status(400).json({ message: err.message }) : next());
router.post('/importar', requirePermission(Permiso.UsuarioCrear), subirExcel, importar);

// Antes todo este router era requireRole('DIRECTOR'). Ahora va por permiso, y
// ENCARGADO también los tiene: dar de alta usuarios dejó de ser exclusivo del
// director. Quién puede hacerlo se cambia en ROL_PERMISOS, sin tocar código.
router.get('/',             requirePermission(Permiso.UsuarioVer),     getAll);
router.post('/',            requirePermission(Permiso.UsuarioCrear),   create);
// Editar la ficha va con el mismo permiso que crearla; cambiar sus roles exige
// además usuario.asignar_rol, que se valida dentro del controller.
router.put('/:id',          requirePermission(Permiso.UsuarioCrear),   update);
router.patch('/:id/toggle', requirePermission(Permiso.UsuarioActivar), toggleActivo);

// Permiso propio, separado de UsuarioCrear: emitir una clave nueva para la
// cuenta de otro es tomar control de esa cuenta, no administrarla. Quien da de
// alta usuarios no necesariamente debe poder hacerlo.
router.patch('/:id/password', requirePermission(Permiso.UsuarioRestablecerPassword), resetPassword);

router.get('/:id/roles',            requirePermission(Permiso.UsuarioVer),         getRoles);
router.post('/:id/roles',           requirePermission(Permiso.UsuarioAsignarRol), asignarRol);
router.delete('/:id/roles/:rolId',  requirePermission(Permiso.UsuarioAsignarRol), quitarRol);

// Ajustes de permisos por persona, encima de los que trae su rol. El GET va con
// usuario.ver porque es solo lectura —saber por qué alguien ve una pantalla es
// parte de administrar usuarios—; escribirlos exige el permiso propio, que no
// viene incluido en asignar_rol: elegir entre roles ya aprobados y fabricar una
// combinación que no existe en ninguno no son la misma facultad.
router.get('/:id/permisos', requirePermission(Permiso.UsuarioVer),            getPermisos);
router.put('/:id/permisos', requirePermission(Permiso.UsuarioAsignarPermiso), setPermisos);

// La otra salida de esa misma pantalla: en vez de dejar la combinación como una
// excepción de una persona, guardarla como un rol del establecimiento que otros
// puedan heredar. Exige además rol.crear y usuario.asignar_rol, que se validan
// dentro del controller para poder decir cuál de los tres falta.
router.post('/:id/permisos/rol', requirePermission(Permiso.UsuarioAsignarPermiso), guardarPermisosComoRol);

module.exports = router;
