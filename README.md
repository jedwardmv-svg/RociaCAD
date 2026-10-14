# RociaCAD

Programa libre para diseñar y calcular sistemas de rociadores automáticos contra incendio, con vista 3D, cálculo hidráulico según el método de NFPA 13, lista de materiales y memoria de cálculo en PDF. Funciona en Windows, Mac y Linux.

> **Estado: versión 0.1, en desarrollo.** Los resultados no están certificados por ninguna autoridad. Todo cálculo debe revisarlo y firmarlo un profesional competente antes de usarse en un proyecto real.

## Qué hace hoy

- **Cálculo hidráulico de demanda** (densidad/área de NFPA 13): Hazen-Williams, factor K, elevación (0,433 psi/ft), longitudes equivalentes de accesorios con los ajustes por coeficiente C y por diámetro interno, asignación de mangueras y comparación contra la curva del suministro (prueba de hidrante).
- **Sistemas en árbol, en lazo y en malla (grid)**: la red se resuelve completa con el método nodal de Newton-Raphson, sin suponer el sentido del flujo.
- **Vista 3D y planta**: dibujo de tubería con ajuste a 45° y a la cuadrícula, colocación de rociadores, colores por material, diámetro, presión o velocidad.
- **Plano de fondo**: cargue el plano arquitectónico en DWG, DXF, PDF o imagen (botón, menú Archivo o arrastrando el archivo) y dibuje la tubería encima. En DWG y DXF se leen las unidades, se pueden ocultar capas y el cursor se ajusta a extremos, vértices y centros del dibujo. Para PDF e imágenes se indica la escala (1:100, 1:50…) o se calibra marcando dos puntos de medida conocida. El plano se guarda dentro del archivo del proyecto. Los DWG se leen con LibreDWG (de AutoCAD R14 a las versiones actuales) con sus colores, textos (fuente de trazo tipo romans.shx, ajustados al ancho real de cada texto y más angostos cuando el estilo usa letra TrueType como Arial), rellenos sólidos, sombreados con patrón, directrices múltiples (MULTILEADER) y objetos en 3D, que se ven en la vista 3D. Las tuberías exportadas por AutoSPRINK (eje con el círculo del diámetro) se dibujan como tubos de su diámetro real. En **Vista** se puede pasar del espacio modelo a las presentaciones de impresión (rótulo, tablas y ventanas al modelo). Las máscaras (WIPEOUT) y las imágenes insertadas todavía no se muestran.
- **Trazado rápido**: *Llenar recinto* reparte los rociadores de un cuarto con dos clics, respetando la separación y la cobertura máximas del riesgo, y crea ramales, bajantes y matriz unida a la red. *Repetir* copia ramales o grupos en fila y los conecta solos a la matriz. Selección por ventana (Mayús + arrastrar), mover, borrar y cambiar diámetro o modelo de varios objetos, y poner o quitar bajantes.
- **Dimensionamiento por tabla** (pipe schedule de NFPA 13, riesgo ligero, ordinario y extra, acero y cobre) según los rociadores que alimenta cada tubo.
- **Codos y tees automáticos en el cálculo**: se deducen del dibujo (tee en cada derivación, codo en cada cambio de dirección) y se suman a la longitud equivalente.
- **Área de diseño según NFPA 13**: la sugerencia automática prueba los rectángulos posibles (N rociadores, lado paralelo a los ramales de al menos 1,2·√A) y deja el que más exige al suministro; también se puede ubicar con el mouse. El panel y la memoria de cálculo revisan el número de rociadores, el área cubierta y la forma, y el contorno se ve en el dibujo.
- **Bombas contra incendio y tanques**: curva de la bomba por los tres puntos de NFPA 20 (caudal cero, nominal y 150 %) sumada a la red pública o a un tanque, con punto de trabajo, presión en la succión, volumen de reserva según la duración y sugerencia de la bomba mínima. La gráfica muestra la red, la bomba y lo disponible.
- **Sistemas secos y de preacción**: área de diseño aumentada 30 % (seco y doble enclavamiento), acero calculado con C = 100, volumen de la parte seca contra los límites de 500 y 750 gal (con acelerador) y tiempo de entrega exigido, y avisos de rociadores que deben ser de tipo seco y de CPVC.
- **Soportes**: colocación automática según NFPA 13 (distancia máxima por material y diámetro, uno por tramo, cerca de los extremos libres, abrazaderas en montantes), largo de varilla hasta la losa o viga dibujada, revisión de distancias y lista de materiales con colgantes, varilla y anclajes. No incluye arriostramiento sísmico.
- **Lista de corte para fabricación**: piezas entre accesorios con largo centro a centro, descuentos de cada accesorio (roscado, ranurado o cementado) y largo de corte; tramos largos partidos en tubos comerciales; tubos necesarios y sobrante; exportación a CSV (Excel) y hoja de fabricación en PDF; etiquetas de piezas en el dibujo.
- **Paneles que se ocultan** para agrandar el área de diseño (Ctrl+1, Ctrl+2, Ctrl+3; Ctrl+4 deja solo el diseño).
- **Etiquetas en el dibujo**: nombres de nodos, tubos y rociadores, o resultados (presión en las uniones, presión y caudal de cada rociador abierto, diámetro y caudal de cada tubo).
- **Lista de materiales**: tubos comerciales por material y diámetro, codos, tees, cruces, reducciones y tapones detectados en el dibujo, válvulas y rociadores, con precios y total.
- **Memoria de cálculo en PDF**: resumen, gráfica de suministro contra demanda en papel N^1,85, tabla por tramos, rociadores, avisos, revisión de reglas y materiales.
- **Revisión de reglas NFPA 13** (pestaña *Revisión NFPA*): separación máxima entre rociadores y entre ramales, área real por rociador (S × L) y cobertura usada en el cálculo, distancia mínima de 6 ft entre rociadores, distancia a los muros (máximo S/2, mínimo 4 in), deflector bajo la losa o el cielo, presión mínima, diámetro mínimo, factor K mínimo, rociadores en sistema seco, área de diseño y soportes. Al hacer clic en un aviso se seleccionan los objetos y la vista va hasta ellos. No revisa obstrucciones, vigas ni cielos inclinados.
- **Planos de entrega en PDF** (botón *Planos*): hojas Carta, Tabloide, A3, A2, A1 o ARCH D con marco y rótulo (proyecto, cliente, contenido, escala, fecha, revisión, hoja N de M) y convenciones; planta a escala normalizada (1:50, 1:100… o 1/8" = 1'-0"…) con el plano de fondo en gris, rociadores con su símbolo, diámetros, largos, elevaciones, nodos del cálculo, soportes, área de diseño y barra de escala; isométrico de la red; y hoja de datos con la placa de datos hidráulicos, el suministro, el cuadro de rociadores, los materiales, las notas generales y el estado de la revisión NFPA.
- **Elementos del edificio**: muros, columnas, vigas, losas, cielos falsos, ductos y tuberías de otros sistemas, dibujados sobre el plano y vistos en 3D.
- **Catálogo editable**: además de las tuberías de fábrica (acero Schedule 10, 40 y 80, galvanizado, CPVC, cobre K/L/M y PVC C900), puede crear sus propias tuberías (diámetros internos y coeficiente C), modelos de rociador (factor K, presión mínima y cobertura de la hoja técnica) y tipos de elemento. El catálogo se exporta e importa como archivo `.rcatalogo` para compartirlo, y cada proyecto guarda los ítems que usa. También se puede llenar en **Excel**: *Plantilla de Excel* descarga un libro con hojas de Tuberías (una fila por tamaño), Rociadores y Elementos, con listas desplegables, las unidades en cada encabezado (mm o in, m o ft, bar o psi; K en gpm/psi½ o L/min/bar½) y sus ítems actuales; *Importar de Excel* lo vuelve a leer, actualiza los ítems del mismo nombre y dice qué filas no entraron y por qué.
- **Exportar a DXF**: la red en 3D con una capa por diámetro, rociadores y elementos, lista para abrir en AutoCAD. Si hay un plano DXF de fondo, se exporta en sus mismas coordenadas para quedar encima.
- **Actualizaciones**: la app avisa cuando hay una versión nueva y, si usted lo autoriza, la descarga, verifica e instala sola y se vuelve a abrir, en Windows, Mac y Linux.
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

Copyright © 2026 Jhon Edward Marquez Valencia.

RociaCAD es software libre: puede redistribuirlo y modificarlo bajo los términos de la **Licencia Pública General de GNU (GPL) versión 3**, o (a su elección) cualquier versión posterior, publicada por la Free Software Foundation. Se distribuye con la esperanza de que sea útil, pero **sin ninguna garantía**. Vea el texto completo en [LICENSE](LICENSE).

El código fuente de cada versión publicada está en este repositorio.

### Componentes de terceros

- [ExcelJS](https://github.com/exceljs/exceljs) (MIT) y [fflate](https://github.com/101arrowz/fflate) (MIT): lectura y escritura de libros de Excel.
- [LibreDWG](https://www.gnu.org/software/libredwg/) (GPL-3.0), a través de [libredwg-web](https://github.com/mlightcad/libredwg-web): lectura de archivos DWG. Los dibujos de ejemplo en `tests/fixtures` vienen de su conjunto de pruebas.
- [Three.js](https://threejs.org) (MIT): vista 3D.
- [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0): planos en PDF.
- [dxf-parser](https://github.com/gdsestimating/dxf-parser) (MIT) y [@tarikjabiri/dxf](https://github.com/dxfjs/writer) (MIT): lectura y escritura de DXF.
- [Electron](https://www.electronjs.org) (MIT) y electron-updater (MIT).
- Fuentes Hershey (textos de los planos): creadas por el Dr. A. V. Hershey en el U. S. National Bureau of Standards; formato de datos original de James Hurt, Cognition, Inc.; datos tomados de [hersheytext](https://github.com/techninja/hersheytextjs) (MIT).
- Tipografía [Barlow](https://github.com/jpt/barlow) (OFL-1.1).
