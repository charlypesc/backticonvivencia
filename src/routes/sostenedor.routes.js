const router = require('express').Router();
const {
  getAll,
  getById,
  create,
  update,
  remove,
  getEstablecimientos,
  asignarEstablecimiento,
  desasignarEstablecimiento,
} = require('../controllers/sostenedor.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken, requireRole('ENCARGADO'));

router.get('/',      getAll);
router.post('/',     create);
router.get('/:id',   getById);
router.put('/:id',   update);
router.delete('/:id', remove);

router.get('/:id/establecimientos',                       getEstablecimientos);
router.put('/:id/establecimientos/:idEstablecimiento',    asignarEstablecimiento);
router.delete('/:id/establecimientos/:idEstablecimiento', desasignarEstablecimiento);

module.exports = router;
