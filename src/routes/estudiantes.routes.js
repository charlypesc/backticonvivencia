const router = require('express').Router();
const { getAll, create, update, toggleActivo, getCursos, consultarRut } = require('../controllers/estudiantes.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

router.get('/',              getAll);
router.get('/cursos',        getCursos);
router.get('/rut/:rut',      consultarRut);
router.post('/',             requireRole('ENCARGADO'), create);
router.put('/:id',           requireRole('ENCARGADO'), update);
router.patch('/:id/toggle',  requireRole('ENCARGADO'), toggleActivo);
module.exports = router;