# ═══════════════════════════════════════════════════════════════════════════
# Teslo Shop API — imagen de producción multi-stage
#
# Por qué multi-stage: la imagen final no debe contener el compilador de
# TypeScript, las devDependencies ni el código fuente. Cada `FROM` arranca una
# etapa nueva y sólo copiamos de la anterior lo que hace falta.
#
# Por qué bookworm-slim y no alpine: `bcrypt` es un módulo nativo. Alpine usa
# musl en lugar de glibc, para el que no hay binario precompilado, así que
# obligaría a instalar python3/make/g++ y compilar. Debian slim usa el prebuild
# y el build es mucho más rápido.
# ═══════════════════════════════════════════════════════════════════════════

# ─── Etapa 1: dependencias completas (incluye devDependencies) ──────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Copiamos sólo los manifiestos antes del código fuente: así Docker reutiliza
# esta capa cacheada mientras package*.json no cambie, aunque cambie src/.
COPY package.json package-lock.json ./

# `npm ci` instala exactamente lo del lockfile (reproducible), a diferencia de
# `npm install`, que puede resolver versiones nuevas.
RUN npm ci


# ─── Etapa 2: compilación ──────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build


# ─── Etapa 3: dependencias de producción únicamente ────────────────────────
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


# ─── Etapa 4: runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
# Nest lee el puerto de process.env.PORT (src/main.ts).
ENV PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/dist          ./dist
COPY package.json ./

# FilesService.getStaticProductImage resuelve join(__dirname, '../../static/products'),
# que desde /app/dist/files/ apunta a /app/static/products. Sin esta copia el
# endpoint GET /api/files/product/:imageName devuelve 400 para las imágenes del seed.
COPY static/products ./static/products

# Directorio de subidas. ATENCIÓN: es almacenamiento efímero. Todo lo que
# suba POST /api/files/product se pierde al reiniciar o redesplegar el
# contenedor. Para producción real: montar un volumen o migrar a S3/Cloudinary.
RUN mkdir -p ./static/uploads && chown -R node:node ./static

# La imagen oficial de Node trae el usuario `node` sin privilegios. Correr como
# root dentro del contenedor es un riesgo innecesario.
USER node

EXPOSE 3000

# Healthcheck para orquestadores. Usa un endpoint público real: la API no tiene
# una ruta /health dedicada, así que /api/products sirve de señal de vida
# (valida también que la conexión a Postgres funciona).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/products').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node dist/main` directamente, no `npm start`: evita el proceso intermedio de
# npm, que no reenvía SIGTERM y rompe el apagado ordenado.
CMD ["node", "dist/main"]
