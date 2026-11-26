import { Product } from './product.entity';

/**
 * Prueba unitaria pura: la entidad no depende de la base de datos ni del
 * contenedor de Nest, así que los hooks @BeforeInsert/@BeforeUpdate se pueden
 * invocar directamente. Es el tipo de test más barato y más estable del
 * proyecto; úsalo como plantilla para la lógica de dominio.
 */
describe('Product entity', () => {
  describe('checkSlugInsert', () => {
    it('genera el slug a partir del título cuando no hay slug', () => {
      const product = new Product();
      product.title = 'T-Shirt Teslo';

      product.checkSlugInsert();

      expect(product.slug).toBe('t-shirt_teslo');
    });

    it('elimina las comillas simples del slug', () => {
      const product = new Product();
      product.title = "Men's Chill Crew Neck Sweatshirt";

      product.checkSlugInsert();

      expect(product.slug).toBe('mens_chill_crew_neck_sweatshirt');
    });

    it('respeta un slug provisto en lugar de derivarlo del título', () => {
      const product = new Product();
      product.title = 'Titulo Que No Se Usa';
      product.slug = 'Slug Explicito';

      product.checkSlugInsert();

      expect(product.slug).toBe('slug_explicito');
    });
  });

  describe('checkSlugUpdate', () => {
    it('normaliza el slug existente al actualizar', () => {
      const product = new Product();
      product.slug = "Nuevo Slug' Raro";

      product.checkSlugUpdate();

      expect(product.slug).toBe('nuevo_slug_raro');
    });
  });
});
