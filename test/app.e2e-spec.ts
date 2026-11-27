import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from './../src/app.module';

/**
 * Tests end-to-end contra una base de datos Postgres real.
 *
 * Requisitos para correrlos:
 *   - local: `docker-compose up -d` y un `.env` válido.
 *   - CI: el job `test-e2e` de .github/workflows/ci.yml levanta Postgres como
 *     service container e inyecta las variables de entorno.
 *
 * IMPORTANTE: createNestApplication() NO aplica nada de src/main.ts, así que
 * el prefijo global y el ValidationPipe se replican aquí a mano. Si no, las
 * rutas responderían sin /api y las aserciones de 400 no probarían nada.
 */
describe('Teslo API (e2e)', () => {
  let app: INestApplication;

  // Email único por ejecución: el seed y las corridas previas dejan datos,
  // y la columna email es UNIQUE.
  const testEmail = `e2e-${Date.now()}@testing.com`;
  const testPassword = 'Abc12345';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
  });

  // Cierra el pool de TypeORM; sin esto Jest no termina el proceso.
  // El guard `if (app)` evita enmascarar un fallo de beforeAll con un
  // "Cannot read properties of undefined" que oculta la causa real.
  afterAll(async () => {
    if (app) await app.close();
  });

  describe('Products', () => {
    it('GET /api/products devuelve la respuesta paginada', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/products')
        .expect(200);

      expect(body).toEqual(
        expect.objectContaining({
          count: expect.any(Number),
          pages: expect.any(Number),
          products: expect.any(Array),
        }),
      );
    });

    it('GET /api/products/:term devuelve 404 si no existe', async () => {
      await request(app.getHttpServer())
        .get('/api/products/producto-que-no-existe')
        .expect(404);
    });

    it('POST /api/products sin token devuelve 401', async () => {
      await request(app.getHttpServer())
        .post('/api/products')
        .send({ title: 'No autorizado', sizes: ['M'], gender: 'men' })
        .expect(401);
    });

    it('GET /api/products rechaza query params no declarados en el DTO', async () => {
      await request(app.getHttpServer())
        .get('/api/products?parametroInventado=1')
        .expect(400);
    });
  });

  describe('Auth', () => {
    let token: string;

    it('POST /api/auth/register crea el usuario y devuelve token', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          fullName: 'Usuario E2E',
        })
        .expect(201);

      expect(body).toEqual(
        expect.objectContaining({
          token: expect.any(String),
          user: expect.objectContaining({ email: testEmail }),
        }),
      );
      // La contraseña nunca debe viajar en la respuesta.
      expect(body.user.password).toBeUndefined();

      token = body.token;
    });

    it('POST /api/auth/register rechaza propiedades fuera del DTO', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: `otro-${Date.now()}@testing.com`,
          password: testPassword,
          fullName: 'Usuario E2E',
          roles: ['admin'], // intento de escalar privilegios
        })
        .expect(400);
    });

    it('POST /api/auth/login con credenciales válidas devuelve token', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword })
        .expect(201);

      expect(body.token).toEqual(expect.any(String));
    });

    it('POST /api/auth/login con password incorrecto devuelve 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: testEmail, password: 'PasswordIncorrecto1' })
        .expect(401);
    });

    it('GET /api/auth/check-status con Bearer válido renueva el token', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/auth/check-status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(body.token).toEqual(expect.any(String));
      expect(body.user.email).toBe(testEmail);
    });

    it('GET /api/auth/check-status sin token devuelve 401', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/check-status')
        .expect(401);
    });

    it('GET /api/auth/private3 devuelve 403 para un usuario sin rol admin', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/private3')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });
});
