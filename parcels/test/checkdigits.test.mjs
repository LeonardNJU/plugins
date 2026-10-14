import { describe, expect, it } from 'vitest';
import { fedex12Check, gs1Mod10, mod7Check, s10Check, upsCheck } from '../src/lib/checkdigits.js';

// Change one digit of a valid number: the check must then fail.
const flipLast = (n) => n.slice(0, -1) + String((Number(n.at(-1)) + 1) % 10);

describe('check digits', () => {
  it('UPS 1Z: accepts published numbers, rejects a changed check digit', () => {
    for (const n of ['1Z999AA10123456784', '1Z5R89390357567127', '1Z879E930346834440', '1Z410E7W0392751591']) {
      expect(upsCheck(n), n).toBe(true);
      expect(upsCheck(flipLast(n)), flipLast(n)).toBe(false);
    }
    // A widely copied "example" whose check digit is wrong.
    expect(upsCheck('1Z12345E0205271688')).toBe(false);
  });

  it('UPU S10: weights 8 6 4 2 3 5 9 7, mod 11 with 10→0 and 11→5', () => {
    // 1*8+2*6+3*4+4*2+5*3+6*5+7*9+8*7 = 204, 204 mod 11 = 6, 11-6 = 5
    expect(s10Check('RR123456785DE')).toBe(true);
    expect(s10Check('EE123456785GB')).toBe(true);
    expect(s10Check('RR123456789DE')).toBe(false);
    // 1*9 + 9*7 = 72, 72 mod 11 = 6 → 5
    expect(s10Check('RR000000195US')).toBe(true);
    // 2*8 + 1*6 = 22, mod 11 = 0 → 11 → 5
    expect(s10Check('RR210000005GB')).toBe(true);
    expect(s10Check('RR210000000GB')).toBe(false);
    // 7*8 = 56, mod 11 = 1 → 10 → 0
    expect(s10Check('RR700000000GB')).toBe(true);
    expect(s10Check('RR700000001GB')).toBe(false);
  });

  it('GS1 mod 10 (DHL SSCC, USPS IMpb)', () => {
    expect(gs1Mod10('00340434161094042557')).toBe(true);
    expect(gs1Mod10(flipLast('00340434161094042557'))).toBe(false);
    expect(gs1Mod10('9205590164917312751089')).toBe(true);
    expect(gs1Mod10('9361289878700317633795')).toBe(true);
    expect(gs1Mod10('9400111899223197428490')).toBe(false);
  });

  it('DHL Express mod 7', () => {
    expect(mod7Check('3318810025')).toBe(true);
    expect(mod7Check('8487135506')).toBe(true);
    expect(mod7Check('3318810026')).toBe(false);
    expect(mod7Check('331881002')).toBe(false);
  });

  it('FedEx 12-digit mod 11', () => {
    for (const n of ['986578788855', '477179081230', '799531274483', '790535312317', '974367662710']) {
      expect(fedex12Check(n), n).toBe(true);
      expect(fedex12Check(flipLast(n)), flipLast(n)).toBe(false);
    }
  });
});
