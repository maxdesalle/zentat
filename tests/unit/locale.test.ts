import { describe, expect, it } from 'vitest';
import { inferCurrencyFromHostname, resolveAmbiguousSymbol } from '../../src/lib/detection/locale';

// Spec: tests/trees/locale.tree

describe('inferCurrencyFromHostname', () => {
  describe('given a single-part country TLD', () => {
    it('maps single TLDs', () => {
      expect(inferCurrencyFromHostname('www.amazon.ca')).toBe('CAD');
      expect(inferCurrencyFromHostname('shop.de')).toBe('EUR');
      expect(inferCurrencyFromHostname('digitec.ch')).toBe('CHF');
    });
  });

  describe('given a two-part country TLD', () => {
    it('maps two-part TLDs', () => {
      expect(inferCurrencyFromHostname('www.amazon.co.uk')).toBe('GBP');
      expect(inferCurrencyFromHostname('www.amazon.com.au')).toBe('AUD');
      expect(inferCurrencyFromHostname('taobao.com.cn')).toBe('CNY');
    });
  });

  describe('given a TLD it does not know', () => {
    it('returns null for unknown TLDs', () => {
      expect(inferCurrencyFromHostname('example.com')).toBe(null);
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
