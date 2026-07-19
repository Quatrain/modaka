import { describe, it, expect } from 'vitest';
import { slugify } from './text';

describe('slugify', () => {
   it('should slugify standard text', () => {
      expect(slugify('Hello World')).toBe('hello-world');
   });

   it('should remove accents', () => {
      expect(slugify('Éléphant')).toBe('elephant');
      expect(slugify('garçon')).toBe('garcon');
   });

   it('should strip special characters', () => {
      expect(slugify('Hello & World!')).toBe('hello-world');
   });

   it('should handle duplicate dashes', () => {
      expect(slugify('hello---world')).toBe('hello-world');
   });
});
