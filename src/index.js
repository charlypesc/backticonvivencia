require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const documentosRoutes = require('./routes/documents.routes');
const pool = require('./db/connection');
const { verificarPermisos } = require('./constants/permisos');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth',        require('./routes/auth.routes'));
app.use('/api/registros',   require('./routes/registros.routes'));
app.use('/api/estudiantes', require('./routes/estudiantes.routes'));
app.use('/api/usuarios',    require('./routes/usuarios.routes'));
app.use('/api/roles',       require('./routes/roles.routes'));
app.use('/api/tipos-falta', require('./routes/tiposFalta.routes'));
app.use('/api/protocolos-genericos',       require('./routes/protocolosGenericos.routes'));
// El grafo de un protocolo del catálogo (pasos, transiciones, roles, campos).
app.use('/api/protocolos-genericos/:id_protocolo/flujo', require('./routes/protocoloFlujo.routes'));
app.use('/api/protocolos-establecimiento', require('./routes/protocolosEstablecimiento.routes'));
// El grafo tal como lo ejecuta un colegio: heredado del catálogo o su copia propia.
app.use('/api/protocolos-establecimiento/:id_protocolo_establecimiento/flujo',
        require('./routes/protocoloFlujoEstablecimiento.routes'));
app.use('/api/protocolos-activados',       require('./routes/protocolosActivados.routes'));
app.use('/api/cursos',         require('./routes/cursos.routes'));
app.use('/api/establecimiento', require('./routes/establecimiento.routes'));
app.use('/api/establecimientos', require('./routes/establecimientos.routes'));
app.use('/api/sostenedores',   require('./routes/sostenedor.routes'));
app.use('/api/geo/paises',     require('./routes/paises.routes'));
app.use('/api/geo/regiones',   require('./routes/regiones.routes'));
app.use('/api/geo/provincias', require('./routes/provincias.routes'));
app.use('/api/geo/comunas',    require('./routes/comunas.routes'));
app.use('/api/geo/establecimientos', require('./routes/establecimientosGeo.routes'));
// app.use('/api/estudiantes', require('./routes/estudiantes.routes'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/notificaciones', require('./routes/notificaciones.routes'));

// ── Ley 21.809 ──────────────────────────────────────────────────────────────
// El calendario que define los días hábiles de los plazos legales.
app.use('/api/feriados', require('./routes/feriados.routes'));
// Acciones sobre una medida ya registrada; el alta cuelga del caso.
app.use('/api/medidas-proteccion', require('./routes/medidasProteccion.routes'));
app.use('/api/medidas-disciplinarias', require('./routes/medidasDisciplinarias.routes'));
app.use('/api/suspensiones-cautelares', require('./routes/suspensionesCautelares.routes'));
// Informe previo de expulsión: se crea desde el caso y se tramita acá.
app.use('/api/informes-expulsion', require('./routes/informesExpulsion.routes'));
// Exportación masiva redactada (retención de 24 meses).
app.use('/api/expedientes', require('./routes/expedientes.routes'));
// RICE y Plan de Gestión, y la constancia de que se entregaron (art. 16 G).
app.use('/api/documentos-institucionales', require('./routes/documentosInstitucionales.routes'));
app.use('/api/constancias', require('./routes/constancias.routes'));

// Document IA
app.use('/api/documents', documentosRoutes);


const PORT = process.env.PORT || 3000;

// El catálogo de permisos del código (src/constants/permisos.js) tiene que
// coincidir con la tabla `permisos`. Si divergen, cada ruta pediría un permiso
// distinto del que cree pedir, así que se aborta antes de aceptar tráfico en
// vez de arrancar con la autorización silenciosamente equivocada.
(async () => {
  try {
    await verificarPermisos(pool);
  } catch (err) {
    console.error('\n' + err.message + '\n');
    process.exit(1);
  }
  // Marca los pasos de protocolo cuyo plazo venció. Se puede apagar con
  // PROTOCOLOS_JOB_MINUTOS=0 y correrlo desde un cron externo.
  require('./services/vencimientos.service').iniciarJob();
  app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
})();