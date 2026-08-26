import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_SYMBOLS,
  inferCurrencyFromHostname,
  resolveAmbiguousSymbol,
} from '../../src/lib/detection/locale';

// Spec: tests/trees/locale.tree

describe('inferCurrencyFromHostname', () => {
  describe('given a single-part country TLD', () => {
    it('maps every supported country ending', () => {
      expect(inferCurrencyFromHostname('www.amazon.ca')).toBe('CAD');
      expect(inferCurrencyFromHostname('www.amazon.uk')).toBe('GBP');
      expect(inferCurrencyFromHostname('shop.de')).toBe('EUR');
      expect(inferCurrencyFromHostname('shop.fr')).toBe('EUR');
      expect(inferCurrencyFromHostname('shop.it')).toBe('EUR');
      expect(inferCurrencyFromHostname('shop.es')).toBe('EUR');
      expect(inferCurrencyFromHostname('shop.nl')).toBe('EUR');
      expect(inferCurrencyFromHostname('shop.be')).toBe('EUR');
      expect(inferCurrencyFromHostname('shop.at')).toBe('EUR');
      expect(inferCurrencyFromHostname('rakuten.jp')).toBe('JPY');
      expect(inferCurrencyFromHostname('taobao.cn')).toBe('CNY');
      expect(inferCurrencyFromHostname('shop.au')).toBe('AUD');
      expect(inferCurrencyFromHostname('shop.in')).toBe('INR');
      expect(inferCurrencyFromHostname('shop.br')).toBe('BRL');
      expect(inferCurrencyFromHostname('shop.mx')).toBe('MXN');
      expect(inferCurrencyFromHostname('shop.kr')).toBe('KRW');
      expect(inferCurrencyFromHostname('digitec.ch')).toBe('CHF');
    });
  });

  describe('given a multi-part hostname ending in a country TLD', () => {
    it('reads the country from the final ending', () => {
      expect(inferCurrencyFromHostname('www.amazon.co.uk')).toBe('GBP');
      expect(inferCurrencyFromHostname('rakuten.co.jp')).toBe('JPY');
      expect(inferCurrencyFromHostname('taobao.com.cn')).toBe('CNY');
      expect(inferCurrencyFromHostname('www.amazon.com.au')).toBe('AUD');
      expect(inferCurrencyFromHostname('shop.co.in')).toBe('INR');
      expect(inferCurrencyFromHostname('shop.com.br')).toBe('BRL');
      expect(inferCurrencyFromHostname('tienda.com.mx')).toBe('MXN');
      expect(inferCurrencyFromHostname('shop.co.kr')).toBe('KRW');
    });
  });

  describe('given a TLD it does not know', () => {
    it('returns null for unknown TLDs', () => {
      expect(inferCurrencyFromHostname('example.com')).toBe(null);
    });
  });

  describe('given a bare country ending', () => {
    it('returns null', () => {
      expect(inferCurrencyFromHostname('ca')).toBe(null);
    });
  });
});

describe('AMBIGUOUS_SYMBOLS', () => {
  describe('given symbols shared by several currencies', () => {
    it('lists every fallback currency in order', () => {
      expect(AMBIGUOUS_SYMBOLS).toEqual({
        $: ['USD', 'CAD', 'AUD', 'MXN'],
        '¥': ['JPY', 'CNY'],
      });
    });
  });
});

describe('resolveAmbiguousSymbol', () => {
  describe('given a dollar sign', () => {
    it('resolves $ by TLD', () => {
      expect(resolveAmbiguousSymbol('$', 'www.amazon.ca')).toBe('CAD');
      expect(resolveAmbiguousSymbol('$', 'www.amazon.com.au')).toBe('AUD');
      expect(resolveAmbiguousSymbol('$', 'tienda.com.mx')).toBe('MXN');
      expect(resolveAmbiguousSymbol('$', 'example.com')).toBe('USD');
    });
  });

  describe('given a yen sign', () => {
    it('resolves ¥ by TLD and page language', () => {
      expect(resolveAmbiguousSymbol('¥', 'taobao.com.cn')).toBe('CNY');
      expect(resolveAmbiguousSymbol('¥', 'rakuten.co.jp')).toBe('JPY');
      expect(resolveAmbiguousSymbol('¥', 'rakuten.co.jp', 'zh-CN')).toBe('JPY');
      // Chinese-language site on a generic TLD
      expect(resolveAmbiguousSymbol('¥', 'shop.example.com', 'zh-CN')).toBe('CNY');
      expect(resolveAmbiguousSymbol('¥', 'shop.example.com', 'ja')).toBe('JPY');
      expect(resolveAmbiguousSymbol('¥', 'shop.example.com')).toBe('JPY');
    });
  });

  describe('given a symbol that means one thing', () => {
    it('returns null for unambiguous symbols', () => {
      expect(resolveAmbiguousSymbol('€', 'example.de')).toBe(null);
      expect(resolveAmbiguousSymbol('£', 'example.co.uk')).toBe(null);
    });
  });
});
