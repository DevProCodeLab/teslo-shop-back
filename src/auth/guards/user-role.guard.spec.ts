import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { User } from '../entities/user.entity';
import { ValidRoles } from '../interfaces';
import { UserRoleGuard } from './user-role.guard';

/**
 * UserRoleGuard es el guard que protege toda la API a través del decorador
 * compuesto @Auth(), así que es el test unitario con mejor relación
 * valor/esfuerzo del proyecto.
 *
 * Patrón: se mockea Reflector (la fuente de la metadata de roles) y se fabrica
 * un ExecutionContext mínimo con sólo lo que el guard consume.
 */
describe('UserRoleGuard', () => {
  let guard: UserRoleGuard;
  let reflector: { get: jest.Mock };

  const buildContext = (user?: Partial<User>) =>
    ({
      getHandler: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as any;

  beforeEach(async () => {
    reflector = { get: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [UserRoleGuard, { provide: Reflector, useValue: reflector }],
    }).compile();

    guard = moduleRef.get(UserRoleGuard);
  });

  it('permite el paso cuando la ruta no declara roles', () => {
    reflector.get.mockReturnValue(undefined);

    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('permite el paso cuando la lista de roles está vacía (@Auth() sin argumentos)', () => {
    reflector.get.mockReturnValue([]);

    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('lanza BadRequestException si la request no trae usuario', () => {
    reflector.get.mockReturnValue([ValidRoles.admin]);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      BadRequestException,
    );
  });

  it('lanza ForbiddenException si el usuario no tiene ninguno de los roles exigidos', () => {
    reflector.get.mockReturnValue([ValidRoles.admin]);
    const context = buildContext({ fullName: 'Test User', roles: ['user'] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('permite el paso cuando el usuario tiene al menos uno de los roles exigidos', () => {
    reflector.get.mockReturnValue([ValidRoles.admin, ValidRoles.superUser]);
    const context = buildContext({
      fullName: 'Admin User',
      roles: ['user', 'admin'],
    });

    expect(guard.canActivate(context)).toBe(true);
  });
});
