# RociaCAD

Programa libre para diseñar y calcular sistemas de rociadores automáticos contra incendio, con vista 3D, cálculo hidráulico según el método de NFPA 13, lista de materiales y memoria de cálculo en PDF. Funciona en Windows, Mac y Linux.

> **Estado: versión 0.1, en desarrollo.** Los resultados no están certificados por ninguna autoridad. Todo cálculo debe revisarlo y firmarlo un profesional competente antes de usarse en un proyecto real.

## Qué hace hoy

- **Cálculo hidráulico de demanda** (densidad/área de NFPA 13): Hazen-Williams, factor K, elevación (0,433 psi/ft), longitudes equivalentes de accesorios con los ajustes por coeficiente C y por diámetro interno, asignación de mangueras y comparación contra la curva del suministro (prueba de hidrante).
- **Sistemas en árbol, en lazo y en malla (grid)**: la red se resuelve completa con el método nodal de Newton-Raphson, sin suponer el sentido del flujo.
- **Vista 3D y planta**: dibujo de tubería con ajuste a 45° y a la cuadrícula, colocación de rociadores, colores por material, diámetro, presión o velocidad.
- **Área de diseño**: selección manual o sugerida (los rociadores hidráulicamente más remotos).
- **Lista de materiales**: tubos comerciales por material y diámetro, codos, tees, cruces, reducciones y tapones detectados en el dibujo, válvulas y rociadores, con precios y total.
- **Memoria de cálculo en PDF**: resumen, gráfica de suministro contra demanda en papel N^1,85, tabla por tramos, rociadores, avisos y materiales.
- Unidades métricas o US, con cambio inmediato.
- Proyectos en archivos `.rcad` (texto JSON).

## Instalar

Descargue el instalador de la última versión en la página **Releases** de este repositorio.

- **Windows**: `RociaCAD-x.y.z-Windows-instalador.exe`. Como el instalador no está firmado con un certificado, Windows puede mostrar "Windows protegió su PC". Haga clic en **Más información** y luego en **Ejecutar de todas formas**.
- **Mac**: `RociaCAD-x.y.z-Mac-arm64.dmg` para equipos con chip Apple (M1, M2…) o `…-Mac-x64.dmg` para Mac con Intel. Arrastre RociaCAD a Aplicaciones. La primera vez, macOS dirá que no puede verificar el desarrollador: abra **Configuración del Sistema → Privacidad y seguridad** y pulse **Abrir igualmente**.
- **Linux**: `RociaCAD-x.y.z-Linux.AppImage`. Dele permiso de ejecución y ábralo.

## Cómo se calcula

1. Cada rociador abierto necesita al menos `q = densidad × área de cobertura` y una presión mínima (7 psi por defecto). La presión requerida es `max(P mín, (q/K)²)`.
2. El programa busca la presión en el punto de suministro con la que el rociador más exigido queda exactamente en su mínimo; los demás quedan por encima, como en un cálculo a mano.
3. En cada tubo: pérdida = 4,52 · Q^1,85 / (C^1,85 · d^4,87) por pie de longitud real más equivalente. Se ignora la presión de velocidad (método de presión total con elevación y fricción, permitido por NFPA 13).
4. A la demanda de rociadores se suma la de mangueras y se compara con la curva `P(Q) = Ps − (Ps − Pr)·(Q/Qr)^1,85`.

Las pruebas automáticas (`tests/`) comparan el motor contra cálculos paso a paso escritos aparte, contra valores de tabla de Hazen-Williams y contra el balance de pérdidas en lazos.

**Limitaciones conocidas**: no incluye bombas contra incendio, sistemas secos (volumen y tiempo de llegada del agua), rociadores ESFR o de almacenamiento, ni la verificación de la forma del área de diseño (regla 1,2·√A). Los accesorios hidráulicos se ingresan por tubo; la detección automática desde el dibujo se usa solo en la lista de materiales.

## Desarrollo

Requiere [Node.js](https://nodejs.org) 22.

```bash
npm install        # instala dependencias
npm run dev        # abre la app en modo desarrollo
npm test           # corre las pruebas del motor hidráulico
npm run dist:win   # crea el instalador de Windows (o dist:mac / dist:linux)
```

Para publicar una versión nueva basta con subir el número de `version` en `package.json` y enviar el cambio a `main`. GitHub Actions crea los instaladores de las tres plataformas y los publica en Releases.

Estructura:

```
src/core/       motor hidráulico, modelo de datos, materiales (sin interfaz, con pruebas)
src/main/       proceso principal de Electron: ventana, menú, archivos, PDF
src/preload/    puente seguro entre la interfaz y el sistema
src/renderer/   interfaz: vista 3D (Three.js), paneles, tablas, reporte
tests/          pruebas automáticas (Vitest)
```

## Licencia

MIT. Vea [LICENSE](LICENSE).
