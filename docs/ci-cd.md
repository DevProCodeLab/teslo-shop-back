# CI/CD con GitHub Actions — guía paso a paso

Guía del pipeline de **Teslo Shop API**. No es sólo una referencia de los
archivos: explica *por qué* cada pieza está donde está, porque eso es lo que se
transfiere a otros proyectos.

---

## 1. Qué construimos

Dos workflows con responsabilidades separadas:

```
                      ┌──────────────────────────────────────────────────────┐
  git push  ─────────▶│  ci.yml   (PR y push a main)                         │
  (rama)              │                                                      │
                      │  ┌─────────┐                                         │
                      │  │ quality │ formato → lint → build                  │
                      │  └────┬────┘                                         │
                      │       ├──────────────┬───────────────┐               │
                      │  ┌────▼─────┐  ┌─────▼──────┐  ┌─────▼────────┐      │
                      │  │test-unit │  │  test-e2e  │  │ docker-build │      │
                      │  │ (sin BD) │  │ (Postgres) │  │  (sin push)  │      │
                      │  └──────────┘  └────────────┘  └──────────────┘      │
                      └──────────────────────────────────────────────────────┘
                                        │
                              ¿todo verde? ──▶ merge a main
                                        │
                      ┌─────────────────▼────────────────────────────────────┐
                      │  release.yml  (push a main / tag v*)                 │
                      │                                                      │
                      │  build-and-push ──▶ ghcr.io/<owner>/<repo>           │
                      │         │                                            │
                      │     deploy  (if: false — cascarón)                   │
                      └──────────────────────────────────────────────────────┘
```

**El principio**: CI *valida*, release *distribuye*. Mezclarlos termina en
artefactos publicados desde ramas de trabajo.

| Archivo | Rol |
|---|---|
| `.github/workflows/ci.yml` | Gate de calidad. Responde "¿es mergeable?" |
| `.github/workflows/release.yml` | Construye y publica la imagen en GHCR |
| `.github/dependabot.yml` | PRs automáticos de actualizaciones |
| `.github/pull_request_template.md` | Checklist de PR |
| `Dockerfile` | Imagen de producción multi-stage |
| `.dockerignore` | Qué NO entra al build context |
| `.gitattributes` | Normalización de finales de línea (CRLF/LF) |

---

## 2. Anatomía de un workflow

Un workflow es un YAML en `.github/workflows/`. Las cuatro claves que importan:

```yaml
name: CI                  # nombre visible en la pestaña Actions

on:                       # QUÉ lo dispara
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:                     # unidades que corren EN PARALELO por defecto
  quality:
    runs-on: ubuntu-latest  # la máquina virtual (runner)
    steps:                  # pasos SECUENCIALES dentro del job
      - uses: actions/checkout@v4   # acción reutilizable de terceros
      - run: npm ci                 # comando de shell
```

Conceptos clave que usa este repo:

- **`jobs` corren en paralelo; `steps` en serie.** Cada job arranca en una VM
  limpia, sin nada de los demás. Por eso cada job repite `checkout` e
  `npm ci`: no heredan nada.
- **`needs`** crea dependencias. `test-e2e` declara `needs: [quality]` para no
  gastar un contenedor de Postgres si el código ni compila.
- **`concurrency`** con `cancel-in-progress: true` cancela runs obsoletos del
  mismo PR. Si empujas tres commits seguidos, sólo el último consume runners.
  En `release.yml` está en `false`: **nunca** se cancela una publicación a medias.
- **`timeout-minutes`** evita que un job colgado queme 6 horas de cuota (el
  default de GitHub).
- **`if: always()`** en el paso de cobertura: sube el reporte incluso si los
  tests fallaron, que es justo cuando lo necesitas.

---

## 3. Los gates y su orden

El orden dentro de `quality` no es estético, es económico: **lo más rápido y
determinista primero**.

| Paso | Qué detecta | Tiempo aprox. |
|---|---|---|
| `npm run format:check` | Formato inconsistente | ~2 s |
| `npm run lint` | Imports muertos, antipatrones, reglas de TS | ~15 s |
| `npm run build` | Errores de compilación de TypeScript | ~20 s |
| `npm run test:ci` | Regresiones de lógica | ~30 s |
| `npm run test:e2e` | Contratos HTTP reales contra Postgres | ~60 s |

Fallar en el segundo 2 en lugar del 60 es la diferencia entre un pipeline que
la gente usa y uno que la gente ignora.

### Por qué `lint` ya no lleva `--fix`

El `package.json` original traía:

```json
"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix"
```

Un linter que **repara** nunca falla, así que como gate de CI es inútil: siempre
sale en verde habiendo modificado archivos que nadie commiteó. Ahora están
separados:

- `npm run lint` → verifica (lo que corre el CI)
- `npm run lint:fix` → repara (lo que corres tú en local)

Mismo criterio con `format` / `format:check`.

### Por qué `--passWithNoTests`

Jest sale con código ≠ 0 si no encuentra tests, lo que rompería el pipeline al
mover archivos. El flag lo evita. No es excusa para no escribir tests: es un
seguro contra un falso rojo.

---

## 4. `npm ci` y no `npm install`

| | `npm install` | `npm ci` |
|---|---|---|
| Lee | `package.json` | `package-lock.json` |
| Puede resolver versiones nuevas | Sí | No |
| Modifica el lockfile | Sí | Nunca (falla si está desfasado) |
| `node_modules` previo | Lo reutiliza | Lo borra y reinstala |
| Velocidad en CI | Menor | Mayor |

En CI se quiere **reproducibilidad**: que el build de hoy instale exactamente lo
mismo que el de hace un mes. `npm ci` lo garantiza y además falla ruidosamente
si `package-lock.json` quedó fuera de sincronía con `package.json` — un bug que
de otro modo aparece semanas después.

> **Consecuencia práctica**: `package-lock.json` **debe** estar commiteado y
> actualizado. Si agregas una dependencia, el lockfile va en el mismo commit.

### Cache de dependencias

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'npm'
```

`cache: 'npm'` guarda `~/.npm` usando el hash de `package-lock.json` como clave.
En el primer run no hay cache (cache miss); en los siguientes `npm ci` baja de
~40 s a unos segundos. Se ve en los logs del paso como
`Cache restored from key: ...`.

---

## 5. Service containers: Postgres efímero para los e2e

Los tests e2e de esta API necesitan una base de datos real: `AppModule` abre una
conexión TypeORM al arrancar. La solución de Actions son los **service containers**:

```yaml
services:
  postgres:
    image: postgres:14.3          # misma versión que docker-compose.yaml
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: teslo_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

GitHub levanta el contenedor junto al runner, lo expone en `localhost:5432` y lo
destruye al terminar el job. Cada ejecución arranca con una base de datos limpia.

**El `--health-cmd pg_isready` no es opcional.** Sin él, el job sigue en cuanto
el contenedor *existe*, no cuando Postgres *acepta conexiones*, y los tests
fallan con `ECONNREFUSED` de forma intermitente. Es la causa número uno de e2e
"flaky" en CI.

### De dónde salen las variables de entorno

`src/app.module.ts` usa `ConfigModule.forRoot()` sin `envFilePath`, así que lee
`.env` — archivo que **no existe en el runner** (está en `.gitignore`, como debe
ser). Las variables del proceso tienen precedencia sobre el archivo, así que se
inyectan desde el job:

```yaml
env:
  STAGE: dev
  DB_HOST: localhost
  DB_PORT: 5432
  DB_USERNAME: postgres
  DB_PASSWORD: postgres
  DB_NAME: teslo_test
  PORT: 3000
  HOST_API: http://localhost:3000/api
  JWT_SECRET: jwt-secret-solo-para-ci
```

Son valores de test, no secretos: la base de datos vive 60 segundos y muere.
Poner esto en `secrets` sería ceremonia sin beneficio.

> **Si agregas una variable de entorno nueva a la app**, va en tres lugares:
> `.env.template`, tu `.env` local, y el bloque `env` del job `test-e2e`.

### `synchronize: true` y por qué aquí nos conviene (y en producción no)

`app.module.ts` tiene `synchronize: true`: TypeORM deriva el esquema de las
entidades y lo crea al conectar. En CI es ideal — base de datos vacía, esquema
listo, cero migraciones que mantener.

**En producción es inaceptable.** `synchronize: true` puede borrar columnas y
datos al interpretar un cambio de entidad. Para un deploy real:

1. `synchronize: false`.
2. Migraciones de TypeORM versionadas en el repo.
3. Un paso de `migration:run` en el deploy, antes de arrancar la app.

Está anotado en la sección de deuda técnica.

### `--runInBand` en los e2e

```json
"test:e2e": "jest --config ./test/jest-e2e.json --runInBand"
```

Por defecto Jest paraleliza las suites. Con una sola base de datos compartida
eso significa escrituras concurrentes sobre las mismas tablas y fallos
aleatorios. `--runInBand` las corre en serie, en un único proceso.

### Por qué el e2e replica la config de `main.ts`

`moduleFixture.createNestApplication()` **no** ejecuta nada de `src/main.ts`.
Sin replicar el prefijo global y el `ValidationPipe`, los tests pegarían a
`/products` en lugar de `/api/products` y las aserciones de 400 no probarían
nada:

```ts
app.setGlobalPrefix('api');
app.useGlobalPipes(
  new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
);
```

Y `afterAll` cierra la app:

```ts
afterAll(async () => {
  await app.close();
});
```

Sin esto el pool de conexiones de TypeORM queda abierto, Jest no termina y el
job se cuelga hasta agotar el `timeout-minutes`.

---

## 6. Secrets, variables y permisos

### `secrets` vs `vars`

| | `secrets` | `vars` |
|---|---|---|
| Se leen con | `${{ secrets.NOMBRE }}` | `${{ vars.NOMBRE }}` |
| Visibles después de crearlos | No | Sí |
| Enmascarados en los logs | Sí | No |
| Para | tokens, claves, passwords | regiones, nombres, flags |

Se crean en **Settings → Secrets and variables → Actions**.

### Qué secrets necesita este repo hoy: ninguno

Publicar en GHCR usa el `GITHUB_TOKEN` que Actions inyecta en cada run:

```yaml
permissions:
  contents: read
  packages: write      # ← lo único extra que hace falta

# ...
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
```

**No hay que crear ningún Personal Access Token.** Es una de las ventajas
concretas de GHCR sobre Docker Hub, donde sí harían falta `DOCKERHUB_USERNAME`
y `DOCKERHUB_TOKEN`.

### Mínimo privilegio

Por defecto el `GITHUB_TOKEN` puede tener permisos amplios de escritura. Ambos
workflows los declaran explícitamente y al mínimo:

- `ci.yml`: `contents: read` — sólo lee código.
- `release.yml`: `contents: read` + `packages: write`.

Si un paso o una action comprometida intenta algo más (abrir un PR, escribir en
el repo), falla. Declarar `permissions` es gratis y acota el daño.

### Qué secret haría falta por proveedor de deploy

| Proveedor | Secrets |
|---|---|
| Railway | `RAILWAY_TOKEN` |
| Render | `RENDER_DEPLOY_HOOK_URL` |
| Fly.io | `FLY_API_TOKEN` (y `fly.toml` en el repo) |
| VPS por SSH | `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` |
| Docker Hub (en vez de GHCR) | `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` |

---

## 7. La imagen Docker

### Multi-stage: por qué cuatro etapas

```
deps       → npm ci (con devDependencies)
builder    → nest build  → produce dist/
prod-deps  → npm ci --omit=dev
runner     → dist/ + node_modules de producción + static/products
```

La imagen final **no contiene** el compilador de TypeScript, las
devDependencies, el código fuente ni los tests. Sólo JavaScript compilado y las
dependencias de runtime.

El orden de los `COPY` también importa: los manifiestos se copian **antes** que
el código fuente.

```dockerfile
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
```

Docker cachea por capa. Así, un cambio en `src/` reutiliza la capa de
`npm ci`; si copiáramos todo primero, cada cambio de una línea reinstalaría las
dependencias.

### Por qué `bookworm-slim` y no `alpine`

Alpine produce imágenes más pequeñas, pero usa **musl** en lugar de glibc.
`bcrypt@5.1.1` es un módulo nativo sin binario precompilado para musl, así que
en Alpine habría que instalar `python3 make g++` y compilarlo: build más lento y
una imagen que acaba *más grande*. Debian slim usa el prebuild directamente.

### `.dockerignore`: la línea crítica

```
postgres/
```

`docker-compose.yaml` monta el data dir de Postgres en `./postgres`, dentro del
repo. El build context se envía **completo** al daemon antes de ejecutar la
primera instrucción del Dockerfile, así que sin esa línea el build arrastra
cientos de megas de archivos binarios de base de datos.

**Síntoma de que falta**: el paso `transferring context` tarda minutos.

### `USER node`

La imagen oficial de Node trae un usuario `node` sin privilegios. Correr como
root dentro del contenedor es un riesgo gratuito: si alguien logra ejecución de
código, lo hace con todos los permisos.

### `CMD ["node", "dist/main"]` y no `npm start`

`npm` no reenvía `SIGTERM` al proceso hijo. Con `npm start`, el orquestador
pide apagado ordenado, nadie lo recibe, y a los 10 segundos llega `SIGKILL`:
conexiones cortadas a la mitad. Ejecutar el binario directo lo evita.

### Limitación conocida: las subidas son efímeras

`POST /api/files/product` escribe en el filesystem del contenedor. **Todo lo
subido se pierde en cada redeploy.** Para producción: volumen montado o mover
el almacenamiento a S3/Cloudinary. Está en deuda técnica.

### Tags que produce `release.yml`

`docker/metadata-action` los deriva del evento en lugar de hardcodearlos:

| Evento | Tags |
|---|---|
| push a `main` | `:latest`, `:main`, `:main-a1b2c3d` |
| tag `v1.2.3` | `:1.2.3`, `:1.2`, `:latest` |

El tag con SHA es el que importa para operar: permite volver a una versión
exacta sin ambigüedad. `:latest` es una conveniencia, no una referencia fiable.

---

## 8. Probar en local antes de pushear

Secuencia que replica lo que hace el CI:

```bash
npm ci
npm run format:check
npm run lint
npm run build
npm run test:ci
```

Para los e2e hace falta la base de datos:

```bash
docker-compose up -d        # Postgres en :5432
npm run test:e2e
```

Y la imagen:

```bash
docker build -t teslo-api:local .
docker images teslo-api:local                    # revisar el tamaño
docker run --rm -p 3000:3000 --env-file .env teslo-api:local
curl http://localhost:3000/api/products
```

> En Windows, `docker build` y `docker-compose` necesitan **Docker Desktop
> corriendo**. Si ves `failed to connect to the docker API at npipe:...`, el
> daemon está apagado.

### Simular el workflow completo con `act`

[`act`](https://github.com/nektos/act) ejecuta los workflows localmente en Docker:

```bash
act pull_request -W .github/workflows/ci.yml
act -j quality                 # un job puntual
```

Útil para iterar sobre el YAML sin generar veinte commits de "fix ci".
Limitaciones: los service containers funcionan parcialmente y `type=gha` (el
cache de Actions) no existe fuera de GitHub.

### Validar la sintaxis del YAML sin ejecutar nada

Un error de indentación en un workflow no se detecta hasta el push. Rápido:

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

O con la extensión *GitHub Actions* de VS Code, que valida contra el esquema
oficial mientras escribes.

---

## 9. Branch protection: el paso que hace que todo esto sirva

**Sin esto los workflows son decorativos.** Puedes mergear un PR con el CI en
rojo y nadie te lo impide.

En **Settings → Branches → Add branch protection rule**:

1. **Branch name pattern**: `main`
2. Activar **Require a pull request before merging**
   - Opcional: *Require approvals* → 1
3. Activar **Require status checks to pass before merging**
   - Activar también *Require branches to be up to date before merging*
   - Buscar y seleccionar los checks:
     - `Formato, lint y build`
     - `Tests unitarios`
     - `Tests e2e (Postgres)`
     - `Verificar build de Docker`
4. Activar **Require conversation resolution before merging**
5. Guardar.

> Los checks sólo aparecen en el buscador **después** de que el workflow haya
> corrido al menos una vez. Si la lista sale vacía: abre un PR primero, deja que
> corra, y vuelve a esta pantalla.

Verificación: abre un PR que rompa el lint a propósito (una variable sin usar) y
confirma que el botón de merge queda bloqueado.

---

## 10. Cómo activar un deploy real

El job `deploy` de `release.yml` está con `if: false`, así que aparece como
*skipped* y nunca como fallido. Para activarlo:

1. **Elegir proveedor** y crear el servicio apuntando a la imagen
   `ghcr.io/<owner>/<repo>:latest`. Si el registro es privado, hay que darle al
   proveedor un token de lectura de GHCR.
2. **Crear el secret** correspondiente (tabla de la sección 6) en
   Settings → Secrets and variables → Actions.
3. **Editar `release.yml`**: borrar la línea `if: false` y descomentar el bloque
   del proveedor.
4. **Provisionar Postgres gestionado** (Neon, Supabase, Railway, RDS) y
   configurar `DB_*`, `JWT_SECRET`, `HOST_API` y `STAGE=prod` como variables de
   entorno **en el proveedor**, no en el repo. `STAGE=prod` activa SSL en
   `app.module.ts`.
5. **Antes del primer deploy real**, resolver `synchronize: true` (sección 5):
   migraciones en lugar de sincronización automática.

### Aprobación manual (opcional pero recomendado)

Descomentar el bloque `environment` del job y crear el entorno en
**Settings → Environments → New environment → `production`**, con *Required
reviewers*. El deploy queda en pausa esperando aprobación humana y además
queda registrado en el historial de Deployments del repo.

---

## 11. Deuda técnica conocida

Esto es una API didáctica de un curso. El pipeline está listo; la aplicación
tiene puntos que hay que resolver antes de un despliegue real:

| # | Tema | Dónde | Riesgo |
|---|---|---|---|
| 1 | `synchronize: true` sin migraciones | `src/app.module.ts` | **Alto** — pérdida de datos al cambiar entidades |
| 2 | Subidas en filesystem efímero | `src/files/` + `Dockerfile` | Alto — se pierden en cada redeploy |
| 3 | Endpoint de seed sin protección | `src/seed/seed.controller.ts` | **Alto** — `GET /api/seed` borra productos y usuarios; `@Auth(ValidRoles.admin)` está comentado |
| 4 | Swagger en la misma ruta que la API | `src/main.ts` (`setGlobalPrefix('api')` + `SwaggerModule.setup('api', ...)`) | Medio — expone el contrato completo en producción |
| 5 | `app.enableCors()` sin restricción de origen | `src/main.ts` | Medio |
| 6 | Vulnerabilidades reportadas por `npm audit` | `package-lock.json` | Medio — Dependabot las irá resolviendo |
| 7 | Sin endpoint `/health` dedicado | — | Bajo — el healthcheck usa `/api/products`, que golpea la BD |
| 8 | `strictNullChecks` y `noImplicitAny` desactivados | `tsconfig.json` | Bajo — menos seguridad de tipos |

El punto 3 es el que atendería primero: es una ruta pública que destruye la base
de datos.

---

## 12. Referencias

- [Sintaxis de workflows](https://docs.github.com/actions/reference/workflow-syntax-for-github-actions)
- [Service containers](https://docs.github.com/actions/using-containerized-services/about-service-containers)
- [Permisos del `GITHUB_TOKEN`](https://docs.github.com/actions/security-for-github-actions/security-guides/automatic-token-authentication)
- [Publicar en GHCR](https://docs.github.com/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [`docker/build-push-action`](https://github.com/docker/build-push-action)
- [Buenas prácticas de Dockerfile](https://docs.docker.com/build/building/best-practices/)
