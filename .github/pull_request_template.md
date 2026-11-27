## Qué cambia

<!-- Una o dos frases. Si hay issue asociado: Closes #123 -->

## Por qué

<!-- El problema o necesidad que resuelve. -->

## Cómo lo probé

<!-- Pasos concretos, no "probé local". Ej: POST /api/auth/register con payload X -> 201 -->

## Checklist

- [ ] `npm run format:check` y `npm run lint` pasan en local
- [ ] `npm test` pasa
- [ ] `npm run test:e2e` pasa (requiere `docker-compose up -d`)
- [ ] Si cambié DTOs o entidades: documenté el impacto en los consumidores
- [ ] Si agregué variables de entorno: están en `.env.template` y en el job `test-e2e` de `ci.yml`
