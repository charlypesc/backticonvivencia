const router = require('express').Router();
const { login, me, cambiarPassword } = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth');

router.post('/login', login);
router.get('/me', verifyToken, me);

// Sin requirePermission: cambiar la propia clave no es una facultad que se
// otorgue, la tiene cualquiera que pueda iniciar sesión. La guardia es la
// contraseña actual, que el controlador verifica.
router.patch('/password', verifyToken, cambiarPassword);

module.exports = router;
