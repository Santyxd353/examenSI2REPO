# Lúmina: catálogo de moda femenina desplegado

Al 23 de septiembre de 2026, la instancia web de Azure muestra exclusivamente moda femenina bajo la marca Lúmina. El surtido inicial contiene 12 referencias verificadas en catálogos oficiales: siete vestidos y cinco faldas, tres por marca. Las fotografías se sirven desde el almacenamiento de la aplicación y se registran en [`catalog-assets/women/catalog.json`](../catalog-assets/women/catalog.json) con su página de origen.

| Marca | Vestidos | Faldas | Página oficial de referencia |
| --- | ---: | ---: | --- |
| Nike | 2 | 1 | https://www.nike.com/w/nike-skirts-and-dresses-2a50cz7yfbz8y3qp |
| adidas | 2 | 1 | https://www.adidas.com/us/women-originals-skirts_dresses |
| Levi's | 1 | 2 | https://www.levi.com/US/en_US/clothing/women/dresses-skirts/c/levi_clothing_women_dresses_skirts |
| PUMA | 2 | 1 | https://us.puma.com/us/en/women/clothing/dresses-and-skirts |

Cada producto tiene variantes S, M y L, un precio en bolivianos para los canales WEB, APP y TIENDA, una fotografía, un PNG frontal transparente para RA y un modelo GLB referencial de vestido o falda. Hay 36 variantes, 36 recursos RA y 36 asociaciones de modelo. Las tres camisetas de demostración anteriores están retiradas del catálogo público, pero conservan sus identificadores e historial en la base de datos.

Los precios, las existencias y el flujo de pago son de demostración académica; no representan inventario ni ofertas oficiales de los fabricantes. Las mallas 3D son siluetas originales aproximadas y no reproducen el patrón, caída, detalles ni ajuste exacto de cada prenda. La aplicación Android superpone de forma aproximada vestidos y faldas sobre la cámara a partir de hombros y cadera; no garantiza el ajuste real. El uso de imágenes de fabricantes requiere revisar sus permisos antes de un uso comercial.

La semilla idempotente está en [`scripts/seed-women.ts`](../scripts/seed-women.ts), se ejecuta al iniciar el contenedor y conserva cuentas, pedidos, historial y recursos RA ya administrados. La fuente de datos de cada referencia está en el manifiesto JSON; los SKU y modelos son propios del prototipo.
