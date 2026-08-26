const crypto = require('crypto');

// Sin 0/O, 1/l/I ni mayúsculas: esta clave se entrega impresa en papel y se
// tipea a mano. Un carácter ambiguo se convierte en un "no puedo entrar" que
// nadie sabe diagnosticar, y sacarlos del alfabeto cuesta poquísima entropía
// frente a lo que queda (32^12 ≈ 2^60 combinaciones).
const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789';

// crypto.randomInt y no Math.random(): esto es material de credenciales, y
// Math.random() es predecible observando unas pocas salidas.
//
// randomInt(n) además es uniforme. El clásico `random % n` le da más
// probabilidad a los primeros caracteres del alfabeto, y acá eso sería un
// sesgo real en cada clave que emitimos.
const generarPassword = (grupos = 3, largoGrupo = 4) =>
  Array.from({ length: grupos }, () =>
    Array.from(
      { length: largoGrupo },
      () => ALFABETO[crypto.randomInt(ALFABETO.length)],
    ).join(''),
  ).join('-');

module.exports = { generarPassword };
