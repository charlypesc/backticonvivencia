const router = require('express').Router();
const { getAll, getByRegistro, create, update, remove } = require('../controllers/protocolosActivados.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

router.get('/',                    getAll);                            // ambos roles
router.get('/registro/:id_registro', getByRegistro);                   // ambos roles
router.post('/',                   requireRole('ENCARGADO'), create);  // solo ENCARGADO
router.put('/:id',                 requireRole('ENCARGADO'), update);  // solo ENCARGADO
router.delete('/:id',              requireRole('ENCARGADO'), remove);  // solo ENCARGADO

module.exports = router;
