// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localizeDocument, t } from '../../src/lib/i18n';

// Spec: tests/trees/i18n.tree

const CATALOGUE: Record<string, string> = {
  greeting: 'Hola',
  placeholderKey: 'Escribe aqui',
  titleKey: 'Titulo',
};

const getMessage = vi.fn((key: string, subs?: string | string[]) => {
  const message = CATALOGUE[key] ?? '';
  return subs ? `${message} ${[subs].flat().join(',')}` : message;
});

beforeEach(() => {
  vi.stubGlobal('browser', { i18n: { getMessage } });
  document.body.innerHTML = '';
  getMessage.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('t', () => {
  describe('given the key exists in the catalogue', () => {
    it('returns the translation', () => {
      expect(t('greeting')).toBe('Hola');
    });
  });

  describe('when substitutions are given', () => {
    it('passes them through', () => {
      expect(t('greeting', ['Max'])).toBe('Hola Max');
      expect(getMessage).toHaveBeenCalledWith('greeting', ['Max']);
    });
  });

  describe('given the key is missing', () => {
    it('returns the key so the omission is visible', () => {
      // getMessage answers '' for an unknown key, which renders as a blank
      // label — a missing translation that looks like a missing feature.
      expect(t('nothingHere')).toBe('nothingHere');
    });
  });

  describe('given the i18n API is unavailable', () => {
    it('returns the key rather than throwing', () => {
      vi.stubGlobal('browser', {});
      expect(t('greeting')).toBe('greeting');
    });
  });
});

describe('localizeDocument', () => {
  describe('given an element carries a text key', () => {
    it('replaces the text', () => {
      document.body.innerHTML = '<span data-i18n="greeting">Hello</span>';
      localizeDocument();
      expect(document.querySelector('span')?.textContent).toBe('Hola');
    });
  });

  describe('given an element carries attribute keys', () => {
    it('sets each named attribute', () => {
      document.body.innerHTML = '<input data-i18n-attr="placeholder:placeholderKey">';
      localizeDocument();
      expect(document.querySelector('input')?.getAttribute('placeholder')).toBe('Escribe aqui');
    });

    it('handles more than one pair', () => {
      document.body.innerHTML =
        '<input data-i18n-attr="placeholder:placeholderKey, title:titleKey">';
      localizeDocument();
      const input = document.querySelector('input');
      expect(input?.getAttribute('placeholder')).toBe('Escribe aqui');
      expect(input?.getAttribute('title')).toBe('Titulo');
    });
  });

  describe('given the attribute list is empty', () => {
    it('leaves the element alone', () => {
      document.body.innerHTML = '<input data-i18n-attr title="keep">';
      localizeDocument();
      expect(document.querySelector('input')?.getAttribute('title')).toBe('keep');
    });
  });

  describe('given an attribute pair is malformed', () => {
    it('skips that pair without touching the others', () => {
      document.body.innerHTML = '<input data-i18n-attr="  ,title:titleKey">';
      localizeDocument();
      expect(document.querySelector('input')?.getAttribute('title')).toBe('Titulo');
    });
  });

  describe('given an element carries an empty text key', () => {
    it('leaves the element alone', () => {
      document.body.innerHTML = '<span data-i18n="">Hello</span>';
      localizeDocument();
      expect(document.querySelector('span')?.textContent).toBe('Hello');
    });
  });

  describe('given no root is given', () => {
    it('localizes the whole document', () => {
      document.body.innerHTML = '<div><span data-i18n="greeting">Hello</span></div>';
      localizeDocument();
      expect(document.querySelector('span')?.textContent).toBe('Hola');
    });
  });

  describe('given a root is given', () => {
    it('leaves elements outside that root alone', () => {
      document.body.innerHTML = '<div id="in"><span data-i18n="greeting">A</span></div>'
        + '<span id="out" data-i18n="greeting">B</span>';
      localizeDocument(document.getElementById('in')!);
      expect(document.querySelector('#in span')?.textContent).toBe('Hola');
      expect(document.getElementById('out')?.textContent).toBe('B');
    });
  });
});
