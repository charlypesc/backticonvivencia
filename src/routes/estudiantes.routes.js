const router = require('express').Router();
const { getAll, create, update, toggleActivo, consultarRut, remove, buscar } = require('../controllers/estudiantes.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

router.get('/',              getAll);
router.get('/buscar',        buscar);
router.get('/rut/:rut',      consultarRut);
router.post('/',             requireRole('ENCARGADO'), create);
router.put('/:id',           requireRole('ENCARGADO'), update);
router.patch('/:id/toggle',  requireRole('ENCARGADO'), toggleActivo);
router.delete('/:id',        requireRole('ENCARGADO'), remove);
module.exports = router;