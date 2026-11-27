# Colección de Postman

- `teslo-shop.postman_collection.json` — todos los endpoints de la API.
- `teslo-shop-local.postman_environment.json` — environment para desarrollo local.

## Importar

En Postman: **Import → File** y selecciona ambos archivos. Luego activa el
environment **Teslo Shop - Local** en el selector de la esquina superior derecha.

El `token` se guarda en el environment (no en la colección), así que no termina
versionado en git. Los scripts de test lo escriben automáticamente al ejecutar
`POST /auth/login`, `POST /auth/register` o `GET /auth/check-status`.

## Orden recomendado

1. `GET {{baseUrl}}/seed` — recrea productos y usuarios. Deja listos
   `test1@google.com` (rol `admin`) y `test2@google.com`, ambos con password
   `Abc123`. Invalida tokens anteriores.
2. `POST /auth/login` con `test1@google.com` / `Abc123` → guarda `token`.
3. `GET /products` → guarda el primer `id` en `productId`.
4. Rutas protegidas: `POST /products`, `PATCH /products/{{productId}}`,
   `DELETE /products/{{productId}}`.

## Notas

- Prefijo global `api`; Swagger queda en `http://localhost:3000/api`.
- El `ValidationPipe` global usa `whitelist` + `forbidNonWhitelisted`: cualquier
  propiedad no declarada en el DTO devuelve 400.
- El token JWT expira en 2h; `GET /auth/check-status` devuelve uno renovado.
- `POST /files/product` usa `form-data` con la key `file` de tipo File (solo
  imágenes). Hay que seleccionar el archivo a mano: Postman no versiona la ruta.
- El gateway de `messages-ws` no se prueba con requests HTTP: el token va en el
  header `authentication` del handshake de Socket.IO.

## Ejecutar desde la CLI

```bash
postman collection run teslo-shop.postman_collection.json \
  -e teslo-shop-local.postman_environment.json
```
