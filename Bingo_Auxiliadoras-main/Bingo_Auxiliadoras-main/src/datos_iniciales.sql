-- Datos iniciales PROVISIONALES del evento. El número de cuenta no es real: cámbialo desde el panel
-- (Administración → Configuración), donde también se editan precio, titular, banco, llave y QR.
-- Se ejecuta una sola vez, después de src/esquema.sql.
UPDATE evento SET
  precio_tabla = 20000,
  moneda = '$',
  tipo_cuenta = 'Ahorros',
  numero_cuenta = '11279075642',
  titular_cuenta = 'Hermanas Auxiliadoras De Cristo Sacerdote'
WHERE id = 1;
