const router = require('express').Router();
const { getMine } = require('../controllers/establecimiento.controller');
const { verifyToken } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');

router.use(verifyToken, resolverScope, requireEstablecimiento);

// Solo lectura: los datos del colegio se editan desde Geo
// (establecimiento.editar). Lo usa Usuarios para sugerir el dominio del correo.
router.get('/', getMine);

module.exports = router;
