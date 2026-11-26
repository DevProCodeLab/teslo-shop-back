<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="200" alt="Nest Logo" /></a>
</p>

# Teslo API

[![CI](https://github.com/DevProCodeLab/teslo-shop-back/actions/workflows/ci.yml/badge.svg)](https://github.com/DevProCodeLab/teslo-shop-back/actions/workflows/ci.yml)
[![Release](https://github.com/DevProCodeLab/teslo-shop-back/actions/workflows/release.yml/badge.svg)](https://github.com/DevProCodeLab/teslo-shop-back/actions/workflows/release.yml)

API REST + WebSockets construida con NestJS, TypeORM y PostgreSQL.

## Puesta en marcha

1. Clonar proyecto
2. `npm install`
3. Clonar el archivo `.env.template` y renombrarlo a `.env`
4. Cambiar las variables de entorno
5. Levantar la base de datos

```
docker-compose up -d
```

6. Levantar:

```
npm run start:dev
```

7. Ejecutar SEED

```
http://localhost:3000/api/seed
```

> El endpoint de seed **borra productos y usuarios** antes de recrearlos, e
> invalida los tokens existentes.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run start:dev` | Servidor en modo watch |
| `npm run build` | Compila a `dist/` |
| `npm run lint` | Verifica con ESLint (no modifica) |
| `npm run lint:fix` | Verifica y repara |
| `npm run format:check` | Verifica formato con Prettier |
| `npm run format` | Aplica formato |
| `npm test` | Tests unitarios |
| `npm run test:ci` | Tests unitarios con cobertura |
| `npm run test:e2e` | Tests e2e (requiere Postgres levantado) |

## Documentación de la API

Con el servidor corriendo, Swagger queda en `http://localhost:3000/api`.

## CI/CD

El repositorio incluye un pipeline de GitHub Actions: validación en cada PR
(formato, lint, build, tests unitarios, tests e2e contra Postgres y build de la
imagen Docker) y publicación de la imagen en GitHub Container Registry al
mergear a `main`.

**Guía completa paso a paso: [`docs/ci-cd.md`](docs/ci-cd.md)**

Ejecutar en local lo mismo que valida el CI:

```bash
npm ci && npm run format:check && npm run lint && npm run build && npm run test:ci
```

## Docker

```bash
docker build -t teslo-api:local .
docker run --rm -p 3000:3000 --env-file .env teslo-api:local
```

O descargar la imagen publicada:

```bash
docker pull ghcr.io/devprocodelab/teslo-shop-back:latest
```

## Notas de producción

Antes de un despliegue real hay que resolver la deuda técnica listada en
[`docs/ci-cd.md`](docs/ci-cd.md#11-deuda-técnica-conocida); en particular
`synchronize: true` (sin migraciones), el almacenamiento efímero de las
imágenes subidas y el endpoint de seed sin protección.
