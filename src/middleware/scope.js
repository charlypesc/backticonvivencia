const { esAdmin } = require('./auth');

// Resuelve qué establecimiento debe filtrar una consulta.
//
// Devuelve null SOLO para un ADMIN que no acotó a ninguno. Ojo: null significa
// "sin filtro", no "ningún establecimiento" — comparar `id_establecimiento =
// NULL` en SQL nunca es verdadero y devolvería siempre vacío.
//
// Para cualquier usuario que no sea ADMIN el parámetro ?id_establecimiento= se
// ignora por completo. Respetarlo dejaría que un DIRECTOR leyera los datos de
// otro colegio con solo cambiar la URL.
function resolverEstablecimiento(req) {
  if (!esAdmin(req)) return req.user.id_establecimiento;
  const pedido = req.query.id_establecimiento;
  return pedido ? Number(pedido) : null;
}

// Deja el alcance resuelto en req.id_establecimiento para que los controladores
// no tengan que decidirlo cada uno por su cuenta.
function resolverScope(req, res, next) {
  req.id_establecimiento = resolverEstablecimiento(req);
  next();
}

// Para los módulos operativos (estudiantes, cursos, registros...) no existe el
// caso "todos los colegios": sus consultas filtran por un establecimiento
// concreto. Un ADMIN tiene que elegir cuál con ?id_establecimiento=.
//
// Sin esto, el ADMIN recibiría 200 con lista vacía en todas las pantallas —
// un fallo silencioso mucho peor de diagnosticar que un 400 explícito.
function requireEstablecimiento(req, res, next) {
  if (req.id_establecimiento === null || req.id_establecimiento === undefined)
    return res.status(400).json({
      message: 'Debes indicar un establecimiento (?id_establecimiento=) para acceder a estos datos',
    });
  next();
}

// Para INSERT/UPDATE: si un ADMIN crea algo sin decir dónde, hay que responder
// 400, nunca insertar con NULL.
function establecimientoRequerido(req) {
  return req.id_establecimiento ?? (req.body?.id_establecimiento
    ? Number(req.body.id_establecimiento)
    : null);
}

module.exports = {
  resolverEstablecimiento,
  resolverScope,
  requireEstablecimiento,
  establecimientoRequerido,
};
