# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

Teslo Shop API: backend REST + WebSockets en NestJS 10 con TypeORM/PostgreSQL. Es el backend del curso de React (Teslo Shop), consumido por un frontend separado.

## Comandos

```bash
npm install
docker-compose up -d        # PostgreSQL 14.3 en :5432 (datos persistidos en ./postgres, ignorado por git)
npm run start:dev           # watch mode
npm run build               # nest build (prebuild hace rimraf dist)
npm start                   # node dist/main (requiere build previo)

# Gates de calidad: las variantes sin sufijo verifican, las :fix / format reparan.
npm run lint                # eslint, NO modifica (es lo que corre el CI)
npm run lint:fix            # eslint --fix
npm run format:check        # prettier --check (lo que corre el CI)
npm run format              # prettier --write

npm test                    # jest, solo *.spec.ts bajo src/
npm run test:ci             # jest con cobertura, para CI
npm run test:e2e            # jest con test/jest-e2e.json (--runInBand, requiere Postgres)
npx jest ruta/al/archivo.spec.ts          # un solo archivo
npx jest -t "nombre del test"             # un solo test por nombre

# Replicar el pipeline completo antes de pushear:
npm ci && npm run format:check && npm run lint && npm run build && npm run test:ci
```

Setup inicial: copiar `.env.template` a `.env` y ajustar variables. Tras levantar la app, ejecutar el seed con `GET http://localhost:3000/api/seed` (borra productos y usuarios, crea los de `src/seed/data/seed-data.ts`).

Variables de entorno requeridas: `STAGE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`, `PORT`, `HOST_API`, `JWT_SECRET`. `docker-compose.yaml` lee `DB_PASSWORD` y `DB_NAME` del mismo `.env`.

## Arquitectura

Módulos en `src/`: `auth`, `products`, `files`, `seed`, `messages-ws`, `common` (DTOs compartidos; módulo vacío por ahora).

**Bootstrap (`src/main.ts`)**: prefijo global `api`, CORS abierto, `ValidationPipe` global con `whitelist` + `forbidNonWhitelisted` (cualquier propiedad no declarada en el DTO produce 400), y Swagger montado en `/api` — es decir, la UI de Swagger comparte ruta con el prefijo de la API.

**Persistencia (`src/app.module.ts`)**: TypeORM con `autoLoadEntities: true` y `synchronize: true`. No hay migraciones: el esquema se deriva de las entidades y se sincroniza al arrancar. SSL se activa solo cuando `STAGE === 'prod'`.

**Auth**: JWT (`passport-jwt`, expira en 2h) con payload `{ id }`. `JwtStrategy.validate` recarga el usuario desde BD y rechaza inactivos, así que revocar un usuario tiene efecto inmediato. `AuthModule` reexporta `TypeOrmModule`, `JwtStrategy`, `PassportModule` y `JwtModule`; por eso `ProductsModule`, `SeedModule` y `MessagesWsModule` lo importan para acceder a `User` y al `JwtService`.

El patrón de protección de rutas es el decorador compuesto `@Auth(...roles)` (`src/auth/decorators/auth.decorator.ts`), que combina `RoleProtected` (metadata `roles`) + `AuthGuard()` + `UserRoleGuard`. Usar siempre `@Auth()` en rutas nuevas, no la combinación manual de guards (las rutas `private`/`private2` de `AuthController` son ejemplos didácticos del curso). Roles válidos en `ValidRoles`: `admin`, `super-user`, `user`. Para leer el usuario autenticado: `@GetUser()` o `@GetUser('email')`.

**Products**: `Product` tiene relación `OneToMany` con `ProductImage` (`cascade` + `eager`) y `ManyToOne` eager con `User`. El `slug` se autogenera desde el `title` en los hooks `@BeforeInsert`/`@BeforeUpdate`. Convención de respuesta: los métodos "plain" (`findOnePlain`, `findAll`) aplanan `images` a un array de URLs en lugar de entidades. `findOne` acepta UUID o `title`/`slug` indistintamente. `update` usa un `QueryRunner` con transacción explícita porque reemplaza las imágenes borrándolas antes de guardar. Los errores de BD pasan por `handleDBExceptions`, que mapea códigos Postgres de duplicado a `BadRequestException`.

**Files**: subida a disco con multer (`./static/products`, nombre UUID vía `fileNamer`, filtro de mimetype vía `fileFilter`). `GET /api/files/product/:imageName` sirve el archivo con `res.sendFile`. La URL devuelta se construye con `HOST_API`, por lo que esa variable debe apuntar al host público real. Nota: `ServeStaticModule` apunta a `../public`, directorio que no existe en el repo; el servicio de imágenes real es el controlador de `files`.

**messages-ws**: gateway Socket.IO que autentica en `handleConnection` leyendo el token del header `authentication` del handshake y verificándolo con `JwtService`; conexión inválida → `disconnect()`. `MessagesWsService` mantiene los clientes conectados en memoria (`connectedClients`) y fuerza una sola sesión por usuario. Eventos: cliente emite `message-from-client`, servidor emite `message-from-server` y `clients-updated`.

**Seed**: `SeedService` borra productos y usuarios, inserta los usuarios de `seed-data.ts` y crea los productos asignándolos al primer usuario. El endpoint está sin protección a propósito (el `@Auth(ValidRoles.admin)` está comentado).

## CI/CD

Pipeline en `.github/workflows/`: `ci.yml` valida cada PR y push a `main`
(jobs `quality`, `test-unit`, `test-e2e` con Postgres como service container, y
`docker-build`); `release.yml` publica la imagen en GHCR al mergear a `main` y
contiene un job `deploy` deshabilitado con `if: false` listo para conectar a un
proveedor.

**La guía detallada está en `docs/ci-cd.md`** — incluye la deuda técnica
conocida de la app (`synchronize: true` sin migraciones, uploads efímeros,
endpoint de seed sin protección). Consultarla antes de proponer cambios de
infraestructura o despliegue.

Al agregar una variable de entorno nueva hay que tocar tres lugares:
`.env.template`, el `.env` local y el bloque `env` del job `test-e2e` en
`ci.yml`.

Los tests e2e (`test/app.e2e-spec.ts`) replican a mano `setGlobalPrefix('api')`
y el `ValidationPipe` de `src/main.ts`, porque `createNestApplication()` no
aplica nada de `main.ts`. Si se cambia la configuración de bootstrap, hay que
reflejarlo ahí.

## Convenciones

- TypeScript con `strictNullChecks` y `noImplicitAny` desactivados; no asumir strict mode.
- Los módulos exponen barrels `index.ts` en `dto/`, `entities/`, `interfaces/`, `decorators/`, `helpers/`; importar desde ahí.
- DTOs con `class-validator` + `@ApiProperty` de Swagger. Toda nueva propiedad de request debe declararse en el DTO o será rechazada por el `ValidationPipe`.
- `UpdateProductDto` se deriva con `PartialType` de `@nestjs/mapped-types`.
- Prettier con `endOfLine: lf` y `.gitattributes` normalizando a LF: el repo se edita en Windows pero el CI corre en Linux.
